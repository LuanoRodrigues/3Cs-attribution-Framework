#!/usr/bin/env python3
import argparse
import json
from pathlib import Path


def _first_sentence(text: str) -> str:
    t = (text or "").strip().replace("\n", " ")
    if not t:
        return ""
    for sep in [". ", "? ", "! "]:
        i = t.find(sep)
        if i > 0:
            return t[: i + 1].strip()
    return t[:260].strip()


def _answer_from_score(v: float, hi: float = 0.67, mid: float = 0.45) -> str:
    if v >= hi:
        return "yes"
    if v >= mid:
        return "partial"
    return "no"


def _derive_claim_kind(clarity: dict, components: list[str]) -> str:
    modes = (clarity or {}).get("responsibility_modes") or {}
    organ = float(((modes.get("conducted_by_state_organs") or {}).get("score_0_1")) or 0.0)
    control = float(((modes.get("non_state_actors_under_state_control") or {}).get("score_0_1")) or 0.0)
    due = float(((modes.get("state_due_diligence_failure") or {}).get("score_0_1")) or 0.0)
    top = max(organ, control, due)
    if top <= 0.0:
        c = " ".join(components).lower()
        if "due_diligence" in c:
            return "due_diligence_omission"
        if "state_sponsorship_or_direction" in c:
            return "non_state_under_control"
        return "unknown"
    winners = []
    if organ >= top - 0.08:
        winners.append("state_organ_conduct")
    if control >= top - 0.08:
        winners.append("non_state_under_control")
    if due >= top - 0.08:
        winners.append("due_diligence_omission")
    if len(winners) > 1:
        return "mixed"
    return winners[0]


def _collect_pathway_evidence(claim: dict, mode_key: str) -> dict:
    sixc = claim.get("six_c") or {}
    coh = (sixc.get("coherence") or {}).get("argument_steps") or []
    corr = (sixc.get("corroboration") or {}).get("corroboration_matrix") or []
    cred = (sixc.get("credibility") or {}).get("sources_supporting_claim") or []
    chain = (sixc.get("chain_of_custody") or {}).get("evidence_items") or []
    components_map = {
        "conducted_by_state_organs": {"actor_identity", "state_sponsorship_or_direction"},
        "non_state_actors_under_state_control": {"state_sponsorship_or_direction", "actor_identity"},
        "state_due_diligence_failure": {"due_diligence_failure", "state_knowledge", "omission"},
    }
    wanted = components_map.get(mode_key, set())
    anchors = []
    sources = set()
    evidence_ids = []
    for step in coh:
        comp = str(step.get("supports_component") or "")
        if wanted and comp not in wanted:
            continue
        for a in step.get("supporting_anchors") or []:
            aid = str(a.get("anchor_id") or "")
            if aid:
                anchors.append(aid)
    for row in corr:
        comp = str(row.get("component") or "")
        if wanted and comp not in wanted:
            continue
        for s in row.get("supported_by_source_ids") or []:
            sid = str(s or "").strip()
            if sid:
                sources.add(sid)
        for a in row.get("supporting_anchors") or []:
            aid = str(a.get("anchor_id") or "")
            if aid:
                anchors.append(aid)
    for row in cred:
        for scomp in row.get("supports_components") or []:
            if wanted and str(scomp or "") not in wanted:
                continue
            sid = str(row.get("source_id") or "").strip()
            if sid:
                sources.add(sid)
            for a in row.get("supporting_anchors") or []:
                aid = str(a.get("anchor_id") or "")
                if aid:
                    anchors.append(aid)
    for i, ev in enumerate(chain, start=1):
        ev_purpose = str(ev.get("evidence_purpose") or "")
        if mode_key == "state_due_diligence_failure" and "link_incident_to_actor" in ev_purpose:
            continue
        evidence_ids.append(f"EV-{i:03d}")
    return {
        "anchors": sorted(set(anchors)),
        "source_ids": sorted(sources),
        "evidence_ids": evidence_ids[:8],
    }


def _build(input_report: dict) -> dict:
    raw = input_report.get("raw_extraction") or {}
    doc_meta = raw.get("document_metadata") or {}
    claims = ((raw.get("stage2_claim_extraction") or {}).get("attribution_claims") or [])
    scored = {}
    for c in ((((input_report.get("scores") or {}).get("full_icj_v3") or {}).get("claims") or [])):
        cid = str(c.get("claim_id") or "")
        if cid:
            scored[cid] = c

    out_claims = []
    for c in claims:
        cid = str(c.get("claim_id") or "")
        stmt_obj = c.get("claim_statement") or {}
        stmt = str(stmt_obj.get("verbatim_text") or "")
        attribution = c.get("attribution") or {}
        subj = c.get("subject") or {}
        comp = [str(x) for x in (c.get("claim_components_asserted") or []) if str(x)]
        score_row = scored.get(cid, {})
        s = score_row.get("scores") or {}
        clarity = (score_row.get("score_details") or {}).get("clarity") or {}
        q = clarity.get("questions") or {}
        modes = clarity.get("responsibility_modes") or {}
        claim_kind = _derive_claim_kind(clarity, comp)

        organ_score = float(((modes.get("conducted_by_state_organs") or {}).get("score_0_1")) or 0.0)
        control_score = float(((modes.get("non_state_actors_under_state_control") or {}).get("score_0_1")) or 0.0)
        due_score = float(((modes.get("state_due_diligence_failure") or {}).get("score_0_1")) or 0.0)
        q1 = q.get("attribution_clarity") or {}
        q2 = q.get("responsibility_mode_clarity") or {}
        q3 = q.get("due_diligence_clarity") or {}

        critical_gaps = []
        if float(organ_score) < 0.40 and claim_kind in {"state_organ_conduct", "mixed"}:
            critical_gaps.append("insufficient_state_organ_link_evidence")
        if float(control_score) < 0.40 and claim_kind in {"non_state_under_control", "mixed"}:
            critical_gaps.append("insufficient_state_control_evidence_for_non_state_actor")
        if float(due_score) < 0.35 and claim_kind in {"due_diligence_omission", "mixed"}:
            critical_gaps.append("insufficient_due_diligence_knowledge_omission_evidence")

        caveats = [
            (x.get("verbatim_text") if isinstance(x, dict) else str(x))
            for x in (c.get("caveats_or_limitations_in_text") or [])
        ]
        alt_hyp = ((c.get("six_c") or {}).get("coherence") or {}).get("alternative_hypotheses_in_text") or []
        contradiction = {
            "counterevidence_items": caveats[:6],
            "alternative_hypotheses_considered": [
                (x.get("statement") if isinstance(x, dict) else str(x))
                for x in alt_hyp
            ][:6],
        }

        time_window = {"start": None, "end": None, "text": None}
        chain_evs = (((c.get("six_c") or {}).get("chain_of_custody") or {}).get("evidence_items") or [])
        if chain_evs:
            ctx = (chain_evs[0].get("collection_context") or {})
            tw = str(ctx.get("collection_time_window") or "").strip()
            if tw:
                time_window["text"] = tw

        legal_tests = {
            "organ_status_test": {
                "score_0_1": round(organ_score, 4),
                "result": _answer_from_score(organ_score, hi=0.60, mid=0.40),
                "rationale": "State-organ attribution support derived from claim/evidence pathway scoring.",
            },
            "effective_control_test": {
                "score_0_1": round(control_score, 4),
                "result": _answer_from_score(control_score, hi=0.60, mid=0.40),
                "rationale": "Control/direction linkage for non-state actors derived from pathway scoring.",
            },
            "due_diligence_test": {
                "score_0_1": round(due_score, 4),
                "result": _answer_from_score(due_score, hi=0.60, mid=0.35),
                "rationale": "Knowledge + omission indicators for due diligence pathway.",
            },
        }

        pathway_evidence = {
            "organ_evidence": _collect_pathway_evidence(c, "conducted_by_state_organs"),
            "control_evidence": _collect_pathway_evidence(c, "non_state_actors_under_state_control"),
            "knowledge_evidence": _collect_pathway_evidence(c, "state_due_diligence_failure"),
            "omission_evidence": _collect_pathway_evidence(c, "state_due_diligence_failure"),
            "territory_evidence": _collect_pathway_evidence(c, "state_due_diligence_failure"),
        }

        final_judgment = str((q1.get("answer") or "no")).lower()
        if final_judgment not in {"yes", "partial", "no"}:
            final_judgment = _answer_from_score(float((q1.get("score_0_1") or 0.0)))

        out_claims.append(
            {
                "claim_id": cid,
                "claim_kind": claim_kind,
                "claim_type": c.get("claim_type"),
                "salience_rank": c.get("salience_rank"),
                "allegation_gravity": ((attribution.get("gravity")) or "medium"),
                "attack_z": _first_sentence(stmt),
                "state_x": attribution.get("attributed_to_name"),
                "attribution_assertion": attribution.get("relationship"),
                "time_window": time_window,
                "target_scope": c.get("scope"),
                "subject": {
                    "name": subj.get("name"),
                    "kind": subj.get("kind"),
                    "aliases": subj.get("aliases") or [],
                },
                "claim_statement": stmt,
                "claim_components_asserted": comp,
                "anchors": {
                    "claim_anchor_id": stmt_obj.get("anchor_id"),
                    "claim_location": stmt_obj.get("location") or {},
                },
                "pathway_evidence": pathway_evidence,
                "legal_tests": legal_tests,
                "clarity_questions": {
                    "q1_attribution_to_state_x_for_attack_z_clear": q1,
                    "q2_responsibility_path_clear_organs_control_due_diligence": q2,
                    "q3_state_knew_and_failed_to_prevent_due_diligence": q3,
                },
                "contradiction_handling": contradiction,
                "final_attribution_judgment": {
                    "value": final_judgment,
                    "score_0_1": float((q1.get("score_0_1") or 0.0)),
                    "band": "high" if float((q1.get("score_0_1") or 0.0)) >= 0.67 else ("medium" if float((q1.get("score_0_1") or 0.0)) >= 0.45 else "low"),
                },
                "critical_gaps": critical_gaps,
                "refinement_meta": {
                    "refined_by_model": "gpt-5-mini",
                    "refinement_timestamp": None,
                    "refinement_notes": "Payload prepared for model-side legal refinement and adjudicative clarity checks.",
                },
                "linked_scores": {
                    "clarity_0_100": s.get("clarity_0_100"),
                    "credibility_0_100": s.get("credibility_0_100"),
                    "corroboration_0_100": s.get("corroboration_0_100"),
                    "custody_0_100": s.get("custody_0_100"),
                },
            }
        )

    return {
        "task": "refine_attribution_claims_for_legal_clarity",
        "model": "gpt-5-mini",
        "schema_version": "claims_payload_v2_legal_clarity",
        "document_id": doc_meta.get("doc_id") or "unknown_doc",
        "document_title": doc_meta.get("title") or "",
        "document_publication_date": doc_meta.get("publication_date"),
        "questions": [
            "Is attribution to State X given attack Z clear?",
            "Was the state culpable/responsible via official organs, control/direction of non-state actors, or allowing operations in its territory clear?",
            "Is it clear that the state knew and failed to prevent, investigate, or suppress operations in its territory (due diligence failure)?",
        ],
        "allowed_claim_kind": [
            "state_organ_conduct",
            "non_state_under_control",
            "due_diligence_omission",
            "mixed",
            "unknown",
        ],
        "claims_count": len(out_claims),
        "claims": out_claims,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="Build refined claims payload for gpt-5-mini legal attribution refinement.")
    ap.add_argument("--input", required=True, help="Path to *_report.json")
    ap.add_argument("--output", required=True, help="Output path for refined claims payload JSON")
    args = ap.parse_args()

    src = Path(args.input).expanduser().resolve()
    out = Path(args.output).expanduser().resolve()
    payload = _build(json.loads(src.read_text(encoding="utf-8")))
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"ok": True, "output": str(out), "claims_count": payload["claims_count"]}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
