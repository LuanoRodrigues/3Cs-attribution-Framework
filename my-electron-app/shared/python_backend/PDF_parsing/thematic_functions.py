import concurrent
import unicodedata
import hashlib
from typing import  List, Dict, Tuple, Set, Callable, Iterable, Final, TypedDict

import pandas as pd

import torch
from tqdm import tqdm

from Z_Corpus_analysis.PDF_widget import PdfViewer
from bibliometric_analysis_tool.utils.Zotero_loader_to_df import find_text_page_and_section
from gpt_api import _process_batch_for
from datetime import datetime
from pydantic import BaseModel, Field


from concurrent.futures import ThreadPoolExecutor, as_completed


class QuoteHit(BaseModel):
    page: int | None
    section_title: str | None
    section_html: str | None

import re


# ------------------------------------------------------------
# Core public entrypoint
# ------------------------------------------------------------



from src.core.utils.calling_models import call_models_old_backin

# ==============================
# Core: extract_themes_and_hierarchy
# ==============================
class TF32Settings(BaseModel):
    enable: bool = Field(default=True, description="Enable TF32 kernels on Ampere+ GPUs")


def configure_tf32(settings: TF32Settings) -> None:
    """
    ###1. Detect CUDA module if present
    ###2. Configure TF32 flags only when CUDA is available
    """
    import torch

    cuda_module = getattr(torch, "cuda", None)
    if cuda_module is None:
        print("TF32 config: torch.cuda not present, using CPU.")
        return

    if not cuda_module.is_available():
        print("TF32 config: CUDA not available, using CPU.")
        return

    backends = getattr(torch, "backends", None)

    if settings.enable:
        if backends is not None:
            cuda_backends = getattr(backends, "cuda", None)
            cudnn_backends = getattr(backends, "cudnn", None)
            if cuda_backends is not None:
                cuda_backends.matmul.allow_tf32 = True
            if cudnn_backends is not None:
                cudnn_backends.allow_tf32 = True
        set_prec = getattr(torch, "set_float32_matmul_precision", None)
        if set_prec is not None:
            set_prec("high")
    else:
        if backends is not None:
            cuda_backends = getattr(backends, "cuda", None)
            cudnn_backends = getattr(backends, "cudnn", None)
            if cuda_backends is not None:
                cuda_backends.matmul.allow_tf32 = False
            if cudnn_backends is not None:
                cudnn_backends.allow_tf32 = False
        set_prec = getattr(torch, "set_float32_matmul_precision", None)
        if set_prec is not None:
            set_prec("highest")


DEFAULT_TF32: Final[TF32Settings] = TF32Settings(enable=True)
configure_tf32(DEFAULT_TF32)

cuda_module_global = getattr(torch, "cuda", None)
if cuda_module_global is not None and cuda_module_global.is_available():
    DEVICE = "cuda"
else:
    DEVICE = "cpu"



# =========================  Global Utilities, Embeddings & Clustering (full replacement)  =========================

import difflib
from collections import  Counter

from sentence_transformers import SentenceTransformer
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.preprocessing import normalize
from sklearn.neighbors import NearestNeighbors

#
# analysis_prompts = {
#     "author": """
# You are analysing how a SINGLE AUTHOR ({author}) constructs and defends an answer to a given research question (RQ).
# Assume all payloads come from this same author and all are relevant to the same RQ.
#
# RQ: {rq}
#
# INPUT MATERIAL:
# Each payload item includes direct_quote, year, researcher_comment, and optional metadata such as theme.
#
# THEORETICAL LENS (MANDATORY):
# Interpret the author's positioning using political sociology:
# - Bourdieu: struggles over capital, expertise, institutional position, jurisdiction.
# - Foucault: production of authority through discourse, surveillance, governance, normalization.
# - Securitization theory: how naming something a "security" problem authorizes exceptional control.
#
# GOAL:
# Produce one integrated analytical section that explains how this author frames the problem raised in RQ, who they empower, who they subordinate, and how they justify that ordering.
#
# You MUST address:
# 1. Problem Framing
#    - How the author defines the core problem in RQ.
#    - What is urgent / risky / in need of control.
#    - What is downplayed or excluded.
#
# 2. Authority / Ownership of the Problem
#    - Who, according to the author, is entitled to speak, act, or decide.
#    - How that authority is justified (expertise, legality, morality, security, stability, inevitability).
#
# 3. Control / Governance Model
#    - What governance arrangement the author normalises (central command, regulated delegation, partnership, etc.).
#    - How that arrangement is legitimated as "the only reasonable" answer to RQ.
#
# 4. Strategic Flexibility / Ambiguity
#    - Internal tensions or carve-outs that keep discretionary power for preferred actors.
#    - How these tensions maintain dominance while appearing responsible.
#
# 5. Responsibility Structure
#    - Who should decide, who should execute, who should absorb blame if things go wrong.
#    - How this allocation advantages some actors over others.
#
# STYLE:
# - One continuous analytical subsection (no bullets).
# - Synthesize patterns; do not just paraphrase each quote.
# - Explicitly tie the analysis to how the author tries to settle RQ in a way that organises power, legitimacy, and accountability.
# """,
#
#     "theme": """
# You are analysing how MULTIPLE AUTHORS collectively construct, contest, and legitimise answers to a shared research question (RQ) within a shared THEME.
#
# RQ: {rq}
# THEME: {theme}
#
# ASSUMPTION:
# All payloads are tagged with this theme but may come from different authors.
#
# THEORETICAL LENS (MANDATORY):
# Use political sociology:
# - Bourdieu: how different actors struggle for authoritative capital (technical, legal, moral) in this theme.
# - Foucault: how governance, regulation, and disciplinary power are normalised.
# - Securitization theory: how invoking "security", "stability", "order", etc. justifies extraordinary authority or intervention.
#
# GOAL:
# Produce one integrated analytical subsection that explains how this theme frames the problem in RQ, where authors converge, where they fight, and what political/structural outcome that produces.
#
# You MUST address:
# 1. Shared Framing
#    - How the theme defines the problem in RQ.
#    - What is treated as non-negotiable or obvious.
#    - How that narrows which answers to RQ are seen as legitimate.
#
# 2. Disagreement / Fault Lines
#    - Where authors within this theme clash.
#    - What dimensions they emphasise (legal risk, escalation/war logic, due diligence, governance capacity, human rights, geopolitical stability, etc.).
#    - What is materially or politically at stake in those disagreements.
#
# 3. Actor Positioning
#    - How states, private firms, alliances, regulators, intelligence services, civil society, the global South, etc. are positioned.
#    - Who is granted agency and authority; who is depicted as needing oversight, discipline, or protection.
#
# 4. Governance Proposals
#    - Which governance models are endorsed (centralised state control, regulated delegation to private actors, multilateral coordination, deterrence-by-punishment, etc.).
#    - How these models solve or redefine the problem in RQ.
#
# 5. Legitimation Patterns
#    - Recurring justifications (legal necessity, technical inevitability, moral duty, stability, proportionality, deterrence credibility).
#    - What worldview that set of justifications normalises.
#
# 6. Structural / Hierarchical Implications
#    - Who ends up empowered, who ends up constrained.
#    - Whose interests are centred vs instrumentalised.
#    - How this reproduces or challenges existing hierarchies.
#
# STYLE:
# - One continuous analytical subsection (no bullets).
# - Do not organise by author; synthesise across them.
# - Make explicit how this theme, as a discursive space, is shaping what counts as a "credible" answer to RQ, and how it re-distributes authority.
# """,
#
#     "temporal": """
# You are analysing how discourse around a SINGLE research question (RQ) CHANGES OVER TIME across MULTIPLE AUTHORS.
#
# RQ: {rq}
# TIMEFRAME: {timeframe}
#
# ASSUMPTION:
# Payloads span multiple years within this timeframe.
#
# THEORETICAL LENS (MANDATORY):
# Use political sociology:
# - Bourdieu: shifting struggles over who has recognised capital to speak for the domain.
# - Foucault: evolution of governance/discipline, normalization of surveillance, bureaucratic control, compliance expectations.
# - Securitization theory: how invoking "threat", "attribution", "deterrence", "stability" legitimises exceptional authority over time.
#
# GOAL:
# Produce one integrated analytical subsection that explains how the framing of RQ evolves across the given timeframe, how authority consolidates or shifts, and how certain responses become normalised as "the way things must be done".
#
# You MUST address:
# 1. Early Framing of the RQ
#    - How the problem in RQ is initially described.
#    - What is uncertain, experimental, high-risk, or politically sensitive early on.
#
# 2. Evolution of Authority
#    - How claims to speak/decide legitimately about RQ shift over time.
#    - Which actors gain recognised authority or jurisdiction later.
#    - How that reflects consolidation of power or attempts to recentralise control.
#
# 3. Normalisation of Practice
#    - Which interventions start as extraordinary or provisional but later get treated as standard operating procedure, best practice, or compliance obligation.
#    - How this "normalisation" turns exceptional governance into routine governance.
#
# 4. Escalation or Managerial Softenings
#    - Does rhetoric move toward crisis / deterrence / security exceptionalism, or toward bureaucratic coordination / standards / due diligence?
#    - Explain how that tonal shift enables or constrains forceful state action, delegation to private actors, collective countermeasures, etc.
#
# 5. Changing Position of Key Actors
#    - Which actors (states, private cybersecurity firms, alliances, multilateral bodies, etc.) gain or lose agency over time.
#    - Who becomes framed as legitimate decision-maker vs object of regulation.
#
# 6. Thresholds for Action
#    - How the bar for acting on the problem in RQ (e.g. calling something an "attack", justifying countermeasures, demanding cooperation) changes.
#    - What that implies about escalation, deterrence credibility, and burden of proof.
#
# CONCLUSION REQUIREMENT:
# End with what the most recent discourse in the timeframe treats as the “proper” or “responsible” answer to RQ: who is authorised to decide, what action is legitimate, and whose interests that settlement serves.
#
# STYLE:
# - One continuous analytical subsection (no bullets).
# - Explicitly contrast "earlier" vs "later".
# - Synthesize across all payloads, not item-by-item summaries.
# - Make explicit how securitization, expertise, legality, and governance narratives shift to stabilise power.
# """
# }
from typing import Any, Mapping, Optional
from pydantic import BaseModel, Field

class AnalysisPromptInput(BaseModel):
    """###1. variables"""
    layer1_mode: str = Field(..., description="One of: 'temporal' | 'author' | 'theme'")
    rq: str = Field(..., description="Research question text")
    layer1_key: Optional[str] = Field(default=None, description="Timeframe (temporal) or author name (author); unused for theme")
    theme_label: Optional[str] = Field(default=None, description="Theme label for theme mode; optional in other modes")
    framework_analysis: bool = Field(default=True, description="If True use framework prompts; else systematic-review fallback")


def _make_custom_index_keys(input_req: str, idx: int) -> str:
    """
    ###1. build deterministic custom_id from input_req and idx
    ###2. keep prefix stable across rounds
    """
    import hashlib as _hash
    base = (input_req or "").encode("utf-8")
    h = _hash.md5(base).hexdigest()[:16]
    return "pyr_" + h
class AnalysisPromptsRegistry:
    """###1. variables"""
    def __getitem__(self, key: Any) -> str:
        data = self._coerce_input(key)
        mode = data.layer1_mode.strip().lower()
        if mode == "temporal":
            return self._temporal(data) if data.framework_analysis else self._temporal_fallback(data)
        if mode == "author":
            return self._author(data) if data.framework_analysis else self._author_fallback(data)
        return self._theme(data) if data.framework_analysis else self._theme_fallback(data)

    def get(self, key: Any, default: Optional[str] = None) -> str:
        """
        ###1. dict-like compatibility helper used by downstream code
        ###2. return default on coercion/render errors when provided
        """
        try:
            return self[key]
        except Exception:
            if default is not None:
                return default
            raise

    @staticmethod
    def _coerce_input(key: Any) -> AnalysisPromptInput:
        """###1. coerce"""
        if isinstance(key, AnalysisPromptInput):
            return key
        if isinstance(key, Mapping):
            mode_raw = str(key.get("layer1_mode") or key.get("mode") or key.get("layer") or "").strip().lower()
            rq_raw = str(key.get("rq") or key.get("research_question") or "").strip()
            layer1_key_raw = key.get("layer1_key")
            theme_label_raw = key.get("theme_label")
            fa_raw = key.get("framework_analysis")
            fa_val = True
            if fa_raw is not None:
                if isinstance(fa_raw, bool):
                    fa_val = fa_raw
                elif isinstance(fa_raw, str):
                    s = fa_raw.strip().lower()
                    fa_val = not (s in ("false", "0", "no", "off", "n"))
                elif isinstance(fa_raw, (int, float)):
                    fa_val = bool(int(fa_raw))
                else:
                    fa_val = bool(fa_raw)

            return AnalysisPromptInput(
                layer1_mode=mode_raw or "theme",
                rq=rq_raw or "",
                layer1_key=str(layer1_key_raw) if layer1_key_raw is not None else None,
                theme_label=str(theme_label_raw) if theme_label_raw is not None else None,
                framework_analysis=fa_val,
            )
        if isinstance(key, str):
            mode_raw = key.strip().lower()
            return AnalysisPromptInput(layer1_mode=mode_raw or "theme", rq="")
        return AnalysisPromptInput(layer1_mode="theme", rq="")

    def _author(self, k: AnalysisPromptInput) -> str:
        a = (k.layer1_key or "").strip() or "(unspecified)"
        return (
            "You are analysing how a SINGLE AUTHOR ({author}) constructs and defends an answer "
            "to the research question (RQ): \"{rq}\". Assume all payloads come from that author "
            "and all are relevant to the same RQ.\n\n"
            "Adopt a constructivist epistemology rooted in the political sociology of international "
            "relations. Treat attribution (and analogous classificatory speech acts in the material) "
            "not as neutral forensic truth-finding but as an exercise of symbolic power that produces "
            "social reality. Following Bourdieu, assume that naming an actor, naming an operation, and "
            "labelling conduct as 'attack', 'espionage', 'crime', etc. is an act of classificatory "
            "control that organises who may legitimately respond, under what legal and political "
            "frameworks, and with what consequences. The author is not only describing a problem; "
            "the author is actively working to stabilise an ordering of authority around that problem.\n\n"
            "Your output must follow two stages:\n\n"
            "Stage 1. Descriptive synthesis (thematic review).\n"
            "- Write several paragraphs that neutrally describe what the payloads are about. "
            "Identify recurring topics, claims, and narrative moves. Report what the author says "
            "about the problem in \"{rq}\", how the situation is portrayed, and which actors appear, "
            "without yet judging or theorising. This is a descriptive mapping of what is being asserted.\n\n"
            "Stage 2. Analytical framework.\n"
            "- After the descriptive synthesis, apply the following six-point framework. "
            "For each point, answer the guiding questions using synthesis across all payloads:\n\n"
            "1. Problem Framing:\n"
            "   - How does the author define the core problem in \"{rq}\"?\n"
            "   - What is constructed as urgent, risky, unstable, or in need of control?\n"
            "   - What is minimised, backgrounded, or treated as politically irrelevant?\n\n"
            "2. Authority / Ownership:\n"
            "   - Who, according to the author, is entitled to speak, diagnose, decide, or intervene?\n"
            "   - On what basis is that entitlement justified (technical expertise, legal mandate, "
            "     national security, market competence, moral duty, institutional responsibility, "
            "     geopolitical stability)?\n"
            "   - Who is positioned as less legitimate and in need of oversight or management?\n\n"
            "3. Justification / Legitimation:\n"
            "   - How does the author make their preferred answer to \"{rq}\" sound necessary, "
            "     reasonable, or inevitable?\n"
            "   - Which register dominates: technical necessity, legal obligation, moral duty, "
            "     order/stability, common sense?\n"
            "   - How is a political move presented as objective fact?\n\n"
            "4. Control / Governance Model:\n"
            "   - What governance arrangement is implied (centralised sovereign control, regulated "
            "     delegation to experts, coordinated public–private partnership, multilateral "
            "     management, supervised self-regulation, etc.)?\n"
            "   - How is this model normalised as the proper or only workable way to handle \"{rq}\"?\n\n"
            "5. Tension / Strategic Flexibility:\n"
            "   - Where does the author create ambiguity or retain discretion (strict standards vs. "
            "     broad exceptions, demands for transparency vs. ambiguous evidence thresholds, "
            "     praise of decentralised expertise vs. reassertion of sovereign primacy)?\n"
            "   - How do these tensions preserve flexibility for the preferred actor(s)?\n\n"
            "6. Responsibility Structure:\n"
            "   - Who is supposed to decide?\n"
            "   - Who is expected to implement the work in practice?\n"
            "   - Who is expected to absorb blame or sanction if outcomes are negative?\n"
            "   - How does this division of decision power, implementation labour, and liability "
            "     answer \"{rq}\" in a way that advantages some actors and subordinates others?\n"
        ).format(author=a, rq=k.rq)

    def _author_fallback(self, k: AnalysisPromptInput) -> str:
        a = (k.layer1_key or "").strip() or "(unspecified)"
        return (
            "You are analysing how a SINGLE AUTHOR ({author}) answers the research question (RQ): "
            "\"{rq}\". Assume all payloads come from that author and concern the same RQ.\n\n"
            "Stage 1. Descriptive synthesis.\n"
            "- Write several paragraphs that neutrally report the author's position, recurring claims, "
            "evidence cited, and stated levels of certainty.\n\n"
            "Stage 2. Systematic-review report.\n"
            "- Summarise points of consistency across the payloads, identify contradictions, and "
            "note evidentiary limits. Avoid theory; focus on what is stated and how it is supported."
        ).format(author=a, rq=k.rq)

    def _theme(self, k: AnalysisPromptInput) -> str:
        t = (k.theme_label or "").strip() or "(unspecified)"
        return (
            "You are analysing how MULTIPLE AUTHORS collectively construct, contest, and legitimise "
            "answers to the shared research question (RQ): \"{rq}\" within the shared THEME \"{theme}\".\n\n"
            "Treat the theme as a field (in Bourdieu's sense) in which actors struggle to impose what "
            "counts as the legitimate definition of the problem named in \"{rq}\", who counts as a "
            "responsible/security-relevant actor, and what form of governance should dominate. "
            "Assume that invoking 'threat', 'stability', 'resilience', 'responsibility', 'due process', "
            "'best practice', or 'norms' are not neutral descriptions but techniques of ordering. "
            "Security language is a bid for exceptional authority; standards/compliance language is a "
            "bid to normalise ongoing governance.\n\n"
            "Your output must follow two stages:\n\n"
            "Stage 1. Descriptive synthesis (theme mapping).\n"
            "- Write several paragraphs that describe, in neutral terms, what the authors in this theme "
            "are talking about. Identify what problems they emphasise in relation to \"{rq}\", which "
            "actors they repeatedly mention, and which solutions they gesture toward. Do not yet judge "
            "or resolve disagreements; just surface the recurring storylines and tensions in the data.\n\n"
            "Stage 2. Analytical framework.\n"
            "- After the descriptive synthesis, apply the following six-point framework. "
            "For each point, answer the guiding questions using synthesis across all payloads:\n\n"
            "1. Shared Framing:\n"
            "   - How do authors in this theme commonly define the core problem posed by \"{rq}\"?\n"
            "   - What is treated as obvious, urgent, or non-negotiable?\n"
            "   - How does that shared framing restrict which answers to \"{rq}\" are treated as "
            "     legitimate or even imaginable?\n\n"
            "2. Disagreement / Fault Lines:\n"
            "   - Where do authors within the theme diverge (law and due process, strategic necessity, "
            "     ethics/rights, economic or operational practicality, sovereignty, budget, markets)?\n"
            "   - What is politically or materially at stake in each disagreement?\n\n"
            "3. Actor Positioning:\n"
            "   - How are key actors (states, private firms, alliances, security services, regulators, "
            "     researchers, civil society, global South, etc.) portrayed?\n"
            "   - Who is granted agency and epistemic authority (the right to define truth and decide)?\n"
            "   - Who is depicted as needing management, discipline, integration, capacity building, "
            "     inclusion, protection, or surveillance?\n\n"
            "4. Governance Proposals:\n"
            "   - What governance models are advanced (centralised sovereign control, regulated "
            "     public–private partnership, multilateral coordination, supervised self-regulation, "
            "     punitive enforcement, etc.)?\n"
            "   - Do authors converge on one model or advance competing models?\n"
            "   - How does each model claim to solve or redefine the problem in \"{rq}\"?\n\n"
            "5. Legitimation Patterns:\n"
            "   - How do authors justify their preferred response to \"{rq}\"?\n"
            "   - Which justificatory grammars dominate (law and due process, technical inevitability, "
            "     market efficiency, moral obligation, systemic stability, deterrence, future "
            "     viability, resilience)?\n"
            "   - What worldview is being normalised as 'common sense'?\n\n"
            "6. Structural / Hierarchical Implications:\n"
            "   - Based on how the theme treats \"{rq}\", who ends up in charge of defining and "
            "     enforcing reality?\n"
            "   - Who ends up constrained, monitored, or governed?\n"
            "   - Whose interests are centred, and whose interests are instrumentalised or backgrounded?\n"
            "   - Does the theme reproduce existing hierarchies (e.g. privileging state security "
            "     bureaucracies or dominant vendors), or does it challenge them?\n"
        ).format(rq=k.rq, theme=t)

    def _theme_fallback(self, k: AnalysisPromptInput) -> str:
        t = (k.theme_label or "").strip() or "(unspecified)"
        return (
            "You are synthesising material addressing the RQ \"{rq}\" within the THEME \"{theme}\".\n\n"
            "Stage 1. Descriptive synthesis.\n"
            "- Summarise the main claims, evidence types, and areas of agreement or disagreement.\n\n"
            "Stage 2. Systematic-review report.\n"
            "- Report convergent findings, list contested points with brief reasons, and outline "
            "gaps for further research. Avoid theory; prioritise verifiable statements."
        ).format(rq=k.rq, theme=t)

    def _temporal(self, k: AnalysisPromptInput) -> str:
        tf = (k.layer1_key or "").strip() or "(unspecified)"
        return (
            "You are analysing how discourse around a SINGLE research question (RQ): \"{rq}\" changes "
            "OVER TIME across MULTIPLE AUTHORS in the timeframe {timeframe}.\n\n"
            "Treat time as a record of struggle over authority. Early material often frames the issue "
            "as uncertain, exceptional, or crisis-level in order to legitimise extraordinary "
            "discretion (securitisation). Later material often routinises those same practices as "
            "professionalised governance, compliance, 'best practice', or responsible behaviour "
            "(governmentality / normalisation). Track that movement explicitly.\n\n"
            "Your output must follow two stages:\n\n"
            "Stage 1. Descriptive synthesis (temporal narrative).\n"
            "- Write several paragraphs narrating how the discussion of \"{rq}\" evolves across the "
            "timeframe {timeframe}. Describe shifts in tone, recurring issues, and which actors are "
            "foregrounded at different moments. Report what happens in the discourse without yet "
            "interpreting it through theory.\n\n"
            "Stage 2. Analytical framework.\n"
            "- After the descriptive synthesis, apply the following six-point framework. "
            "For each point, answer the guiding questions using synthesis across all payloads:\n\n"
            "1. Early Framing of the RQ:\n"
            "   - In the earliest material, how is the problem in \"{rq}\" described?\n"
            "   - What is presented as uncertain, exceptional, risky, or not yet governable?\n"
            "   - Which actors initially claim the right to speak, and on what grounds "
            "     (technical forensics, national security prerogative, market expertise, legal "
            "     mandate)?\n\n"
            "2. Evolution of Authority:\n"
            "   - How do claims to epistemic and decision authority shift over time?\n"
            "   - Who is treated as the legitimate decision-maker or voice early on, and who is "
            "     treated as legitimate later?\n"
            "   - Does authority centralise (e.g. sovereign control), diffuse (public–private "
            "     partnership), professionalise (specialist bureaucracies), or get reabsorbed into "
            "     legal/oversight institutions?\n\n"
            "3. Normalisation of Practices:\n"
            "   - Which practices begin as provisional, exceptional, or controversial responses to "
            "     \"{rq}\" (rapid public attribution, retaliatory measures, outsourcing forensic work "
            "     to private vendors, naming-and-shaming, sanctions, threat intelligence sharing)?\n"
            "   - Which of those practices later get described as routine, expected, 'best practice', "
            "     or due diligence?\n"
            "   - How does emergency logic harden into everyday governance?\n\n"
            "4. Escalation or Softening of Stakes:\n"
            "   - Does the tone move from crisis/urgency ('threat', 'must not be tolerated', "
            "     'national security', 'deterrence') toward managerial calm ('coordination', "
            "     'standards', 'responsible behaviour', 'maturity of practice'), or the reverse?\n"
            "   - How does this tonal shift redefine what levels of intervention, retaliation, "
            "     regulation, partnership, or oversight are considered legitimate?\n\n"
            "5. Changing Position of Key Actors:\n"
            "   - Over time, how do descriptions of major actors relevant to \"{rq}\" change?\n"
            "   - Which actors gain agency, credibility, and decision power in later material?\n"
            "   - Which actors shift from autonomous actors to actors that must be guided, "
            "     integrated, disciplined, or protected?\n"
            "   - How is symbolic capital redistributed (who gets to classify reality vs. who is "
            "     classified)?\n\n"
            "6. Shift in Action Thresholds:\n"
            "   - How does the bar for legitimate intervention move over time?\n"
            "   - Do we see a move from 'caution before acting' to 'rapid action is necessary and "
            "     expected', or the reverse?\n"
            "   - How does this shift make regulation, retaliation, sanctions, technical mandates, "
            "     or cross-sector information sharing easier or harder to justify?\n\n"
            "After applying points 1–6, conclude with a statement of what the most recent material in "
            "the timeframe treats as the proper answer to \"{rq}\": who is authorised to decide, "
            "what intervention is legitimate, and whose interests that settlement protects.\n"
        ).format(rq=k.rq, timeframe=tf)

    def _temporal_fallback(self, k: AnalysisPromptInput) -> str:
        tf = (k.layer1_key or "").strip() or "(unspecified)"
        return (
            "You are reporting how discussion of the RQ \"{rq}\" evolves OVER TIME across "
            "MULTIPLE AUTHORS in {timeframe}.\n\n"
            "Stage 1. Descriptive synthesis.\n"
            "- Describe key phases, recurring topics, and notable changes in emphasis.\n\n"
            "Stage 2. Systematic-review report.\n"
            "- Summarise stable findings, highlight shifts in claims or evidence, and note "
            "periods where conclusions are uncertain or weakly supported."
        ).format(rq=k.rq, timeframe=tf)



analysis_prompts = AnalysisPromptsRegistry()

def format_analysis_prompt(inp: Any, user_hint: Optional[str]) -> str:
    """
    Accepts AnalysisPromptInput | Mapping[str, Any] | str
    and returns the formatted analysis prompt with optional user hint appended.
    """
    coerced: AnalysisPromptInput = analysis_prompts._coerce_input(inp)
    base: str = analysis_prompts[coerced]
    extra: str = (user_hint or "").strip()
    if not extra:
        return base
    return (
        base.rstrip()
        + "\n\nEXTRA CONTEXT FROM USER (treat as additional analytic emphasis; "
          "do NOT override any structural/output rules):\n"
        + extra
    )
def _norm_for_match(s: str, *, case_sensitive: bool = False) -> str:
    from html import unescape
    t = unescape(s or "")
    if not case_sensitive:
        t = t.lower()
    t = t.replace("\u00ad", "")
    t = t.replace("\u2019", "'").replace("\u2018", "'").replace("\u201c", '"').replace("\u201d", '"')
    t = re.sub(r"\s+", " ", t)
    return t.strip()

def _highlight_html(title: str, body: str, needle: str, *, case_sensitive: bool = False) -> str:
    out=""
    flags = 0 if case_sensitive else re.IGNORECASE

    def _apply(pat: "re.Pattern", text_src: str) -> tuple[str, bool]:
        parts, last, matched = [], 0, False
        for m in pat.finditer(text_src):
            parts.append(escape(text_src[last:m.start()]))
            parts.append("<mark>" + escape(m.group(0)) + "</mark>")
            last = m.end()
            matched = True
        parts.append(escape(text_src[last:]))
        return "".join(parts), matched

    did = False
    if needle:
        pat_exact = re.compile(re.escape(needle), flags)
        out, did = _apply(pat_exact, body or "")
        if not did:
            words = re.findall(r"\w+", needle)
            if words:
                pat_loose = re.compile(r"(?:\b" + r"\b[\s\W]+\b".join(map(re.escape, words)) + r"\b)", flags)
                out, did = _apply(pat_loose, body or "")
    if not did:
        from html import escape
        out = escape(body or "")

    # paragraphise
    paras = re.split(r"\n{2,}", out)
    paras_html = []
    for p in paras:
        p = p.replace("\n", "<br/>")
        if p.strip():
            paras_html.append(f"<p>{p}</p>")
    body_html = "\n".join(paras_html) if paras_html else "<p></p>"

    from html import escape as _esc
    return f'<section class="pdf-section"><h3>{_esc(title or "")}</h3>\n{body_html}\n</section>'

class QuoteCleanerInput(BaseModel):
    raw: str = Field(default="")


def _strip_matching_wrappers(text: str) -> str:
    """
    Internal helper: if the entire string is surrounded by matching quotes
    or similar wrappers, peel them off.

    Examples:
    '"hello."'     -> 'hello.'
    '“hello”'      -> 'hello'
    "'hello'"      -> 'hello'
    "«hello»"      -> 'hello'
    """
    wrappers = [
        ('"', '"'),
        ("'", "'"),
        ("“", "”"),
        ("‘", "’"),
        ("«", "»"),
        ("(", ")"),
        ("[", "]"),
        ("{", "}"),
    ]

    # one pass only; do not recurse because nested punctuation may be meaningful
    t = text
    if len(t) >= 2:
        first_char = t[0]
        last_char = t[-1]
        for left, right in wrappers:
            if first_char == left and last_char == right:
                inner = t[1:-1].strip()
                return inner
    return t


def _clean_quote(raw: str) -> str:
    """
    Normalize a direct quote string so that:
    - dictionary keys in build_quote_hits_from_jobs match
      dictionary keys later in _enrich_batch_records_from_jobs
    - fuzzy OCR whitespace / smart punctuation differences
      don't cause misses.

    Steps:
    1. Coerce to str and strip outer whitespace.
    2. Replace smart quotes / dashes with ascii.
    3. Lowercase for case-insensitive match.
    4. Collapse ALL whitespace (newline, tab) -> single space.
    5. Remove symmetrical wrapping quotes if the *entire* string
       is wrapped.
    6. Trim leading/trailing punctuation like .,;: again.

    Returns:
        cleaned stable string usable as a dict key.
    """

    data = QuoteCleanerInput(raw=str(raw))

    # 1. base text
    txt: str = data.raw.strip()

    # 2. normalize curly quotes / dashes commonly seen in PDFs
    replacements = {
        "“": '"',
        "”": '"',
        "‘": "'",
        "’": "'",
        "—": "-",
        "–": "-",
        "-": "-",   # non-breaking hyphen
        "‒": "-",
        "…": "...",
        "\u00a0": " ",  # non-breaking space
    }
    # manual loop (not using dict comprehension in-place mutation ambiguity)
    norm_chars: list[str] = []
    for ch in txt:
        if ch in replacements:
            norm_chars.append(replacements[ch])
        else:
            norm_chars.append(ch)
    txt = "".join(norm_chars)

    # 3. lowercase
    txt = txt.lower()

    # 4. collapse any whitespace runs (space/newline/tab etc.) to single ASCII space
    #    using regex: any sequence of whitespace -> " "
    txt = re.sub(r"\s+", " ", txt).strip()

    # 5. peel symmetric wrappers like quotes/parens IF whole-string wrapped
    txt = _strip_matching_wrappers(txt)

    # 6. final trim of leading/trailing punctuation noise
    #    e.g. leading/trailing '.', ',', ';', ':', '"', "'" etc.
    txt = txt.strip(" \t\r\n\"'`.,;:!?()[]{}<>")

    return txt

def build_quote_hits_from_jobs(
    jobs: List[Tuple[Dict[str, Any], str]],
    df,
    pdf_lookup: Dict[str, str],
    threads: int = 32,
    **kwargs: Any
) -> Dict[str, Dict[str, Dict[str, Any]]]:
    """
    ###1. collect cleaned quotes per item_key
    ###2. group item_keys by pdf_path
    ###3. warm caches per pdf
    ###4. scan quotes per pdf in parallel, using cached pdf/sections
    ###5. build {item_key -> {quote_clean -> hit_info}}
    """
    from tqdm.auto import tqdm as _tqdm

    progress_cb = kwargs.get("progress_cb")
    if not callable(progress_cb):
        progress_cb = None

    def _iter_pairs() -> Iterable[Tuple[str, str]]:
        for job, _prompt in jobs:
            payloads = job.get("payloads") or []
            for ev in payloads:
                dq_raw = (ev.get("direct_quote") or "").strip()
                ik_raw = (ev.get("item_key") or "").strip()
                if dq_raw and ik_raw:
                    yield (ik_raw, dq_raw)

    groups: Dict[str, Set[str]] = {}
    for ik, dq in _iter_pairs():
        dq_clean = _clean_quote(dq)
        if dq_clean:
            bucket = groups.get(ik)
            if bucket is None:
                bucket = set()
                groups[ik] = bucket
            bucket.add(dq_clean)

    items: List[Tuple[str, Set[str]]] = list(groups.items())
    total_items = len(items)

    if progress_cb and total_items:
        msg = f"[RUNTIME] PDF quote hit map ready for {total_items} item(s)."
        print(msg, flush=True)
        progress_cb(msg)

    pdf_to_items: Dict[str, Dict[str, Set[str]]] = {}
    for ik, qset in items:
        pdf_path = pdf_lookup.get(ik, "")
        if pdf_path:
            mapping = pdf_to_items.get(pdf_path)
            if mapping is None:
                mapping = {}
                pdf_to_items[pdf_path] = mapping
            mapping[ik] = qset

    for pdf_path_candidate in pdf_to_items.keys():
        _ = process_pdf(
            pdf_path_candidate,
            cache=True,
            cache_full=True,
            core_sections=True,
        )

    out: Dict[str, Dict[str, Dict[str, Any]]] = {}

    import os, threading
    import threading

    max_workers = threads
    if max_workers <= 0:
        max_workers = 32


    total_quotes = 0
    for _pdf_path, mapping in pdf_to_items.items():
        for _ik, qset in mapping.items():
            total_quotes += len(qset)

    if progress_cb and total_items:
        msg = f"[RUNTIME] Scanning {total_quotes} quote(s) across {total_items} item(s) for PDF locations…"
        print(msg, flush=True)
        progress_cb(msg)

    bar = None
    if total_quotes > 0:
        bar = _tqdm(
            total=total_quotes,
            desc="PDF quote hit scan",
            unit="quote",
            dynamic_ncols=True,
        )

    lock = threading.Lock()

    def _worker_for_pdf(
        pdf_path: str,
        item_map: Dict[str, Set[str]],
    ) -> Dict[str, Dict[str, Dict[str, Any]]]:
        local_out: Dict[str, Dict[str, Dict[str, Any]]] = {}
        for item_key, qset in item_map.items():
            per_item: Dict[str, Dict[str, Any]] = {}
            for q_clean in qset:
                hit = find_text_page_and_section(
                    pdf_path=pdf_path,
                    text=q_clean,
                    page=True,
                    section=True,
                    cache=True,
                    cache_full=True,
                )

                per_item[q_clean] = {
                    "page": hit.get("page"),
                    "section_title": hit.get("section_title"),
                    "section_text": hit.get("section_text"),
                    "citations": hit.get("citations"),
                    "references": hit.get("references"),
                }

                if bar is not None:
                    lock.acquire()
                    bar.update(1)
                    lock.release()
            local_out[item_key] = per_item
        return local_out

    from concurrent.futures import ThreadPoolExecutor, as_completed

    pdf_items_list = list(reversed(pdf_to_items.items()))
    with ThreadPoolExecutor(max_workers=max_workers) as exe:
        futures = [
            exe.submit(_worker_for_pdf, pdf_path, item_map)
            for pdf_path, item_map in pdf_items_list
        ]
        for fut in as_completed(futures):
            pdf_out = fut.result()
            for item_key, hits in pdf_out.items():
                out[item_key] = hits

    if bar is not None:
        bar.close()

    if progress_cb and total_items:
        msg_done = f"[RUNTIME] Finished PDF quote hit scan: {total_quotes} quote(s) across {total_items} item(s)."
        print(msg_done, flush=True)
        progress_cb(msg_done)

    return out



# ------------------------- Canonicalization & small utils -------------------------

def _canon_theme(s: str) -> str:
    """Canonicalize a theme token: trim, collapse spaces, lowercase."""
    s = (s or "").strip()
    s = " ".join(s.split())
    return s.lower()

def _stable_theme_id(term: str, prefix: str = "th_", n: int = 10) -> str:
    """Deterministic short id from canonicalized term."""
    h = hashlib.md5(_canon_theme(term).encode("utf-8")).hexdigest()
    return f"{prefix}{h[:n]}"

def _ensure_list(x) -> List[Any]:
    if x is None:
        return []
    return x if isinstance(x, list) else [x]

def _deepcopy_like(obj: Any) -> Any:
    """Lossless deep copy via JSON round-trip (safe for dict/list payloads)."""
    return json.loads(json.dumps(obj, ensure_ascii=False))

def _parse_coverage(html: str) -> dict:
    """
    Accepts either:
      <!-- coverage used=K1,K2 unused=U1,U2 -->
    or:
      <!-- coverage used=[K1,K2] unused=[U1,U2] -->
    Returns {"used": [...], "unused": [...]} (keys are strings, de-duplicated, order preserved).
    """
    # First try bracketed form
    m = re.search(
        r"<!--\s*coverage\s+used=\[(.*?)\]\s*(?:unused=\[(.*?)\])?\s*-->",
        html or "", flags=re.IGNORECASE | re.DOTALL
    )
    if not m:
        # Then try plain CSV form
        m = re.search(
            r"<!--\s*coverage\s+used=([^>\n]*?)(?:\s*,?\s*unused=([^>\n]*?))?\s*-->",
            html or "", flags=re.IGNORECASE | re.DOTALL
        )

    used_raw = m.group(1) if m else ""
    unused_raw = m.group(2) if (m and m.lastindex and m.group(2) is not None) else ""

    def _split_csv(s: str) -> List[str]:
        out = []
        for tok in (s or "").replace("[","").replace("]","").split(","):
            t = tok.strip()
            if t and t not in out:
                out.append(t)
        return out

    return {"used": _split_csv(used_raw), "unused": _split_csv(unused_raw)}

def _collect_section_tags_and_paragraphs(html: str) -> tuple[List[str], List[Dict[str, Any]]]:
    """
    Returns:
      - section_tags: union of all paragraph data-tags (unique, sorted)
      - paragraphs: [{id, tags, paragraph_html}]
    """
    soup = BeautifulSoup(html or "", "html.parser")
    tag_set = set()
    paragraphs = []
    for p in soup.find_all("p"):
        pid = p.get("id") or ""
        raw = p.get("data-tags")
        tags = []
        if isinstance(raw, str) and raw.strip():
            tags = [t.strip() for t in raw.split(";") if t.strip()]
            tag_set.update(tags)
        paragraphs.append({
            "id": pid,
            "tags": tags,
            "paragraph_html": str(p)
        })
    return sorted(tag_set), paragraphs

def _collect_anchors_from_paragraph(p_tag) -> List[Dict[str, Any]]:
    """
    For a given <p>, return list of anchors with:
      paragraph_id, tags (from this paragraph), data_key, title, href, anchor_html
    """
    pid = p_tag.get("id") or ""
    raw = p_tag.get("data-tags")
    p_tags = []
    if isinstance(raw, str) and raw.strip():
        p_tags = [t.strip() for t in raw.split(";") if t.strip()]

    out = []
    for a in p_tag.find_all("a"):
        data_key = a.get("data-key") or ""
        title = a.get("title") or ""
        href = a.get("href") or ""
        out.append({
            "paragraph_id": pid,
            "tags": list(p_tags),
            "data_key": data_key,
            "title": title,
            "href": href,
            "anchor_html": str(a),
        })
    return out
def _extract_tags_and_coverage(html: str) -> tuple[list[str], dict]:
    # collect tags from <p data-tags="t1;t2;...">
    tags_set = set()
    soup = BeautifulSoup(html or "", "html.parser")
    for p in soup.find_all("p"):
        raw = p.get("data-tags")
        if isinstance(raw, str) and raw.strip():
            for t in raw.split(";"):
                t = t.strip()
                if t:
                    tags_set.add(t)

    # parse optional coverage comment: <!-- coverage used=K1,K2,... unused=U1,U2,... -->
    used, unused = [], []
    m = re.search(
        r"<!--\s*coverage\s+used=([^>]*?)(?:\s*,?\s*unused=([^>]*?))?\s*-->",
        html or "",
        flags=re.IGNORECASE | re.DOTALL,
    )
    if m:
        def _csv(s: str) -> list[str]:
            return [x.strip() for x in (s or "").split(",") if x and x.strip()]
        used = _csv(m.group(1))
        unused = _csv(m.group(2) if m.lastindex and m.group(2) is not None else "")

    return sorted(tags_set), {"used": used, "unused": unused}
# ------------------------- Tunables -------------------------

# Character-level fuzzy thresholds (SequenceMatcher)
FUZZY_SIM_THRESHOLD: float = 0.86       # general fuzzy merge; nudge to 0.85 if you still see splits
HARD_CHAR_THRESHOLD: float = 0.94       # near-identical variants (hyphen/spacing/punct)

# Embedding thresholds (backend chooses its own recommended gate; this is a hard floor)
EMB_SIM_FLOOR: float = 0.60

# Candidate generation safety
MAX_PAIRS_PER_BUCKET: int = 250_000

# LLM job sizing (used when packing clusters to jobs)
MIN_THEMES_PER_JOB: int = 20
MAX_THEMES_PER_JOB: int = 80

# Content stopwords (small set; only for candidate gating)
_STOPWORDS: Set[str] = {
    "a", "an", "the", "of", "and", "or", "for", "to", "on", "in", "by", "with",
    "from", "about", "under", "over", "between", "into", "as", "vs", "versus", "via", "per", "at"
}

# Guard phrases to avoid over-merging distinct legal heads (adjust for your domain)
_GUARD_PHRASES: Set[str] = {
    "self defense", "self-defence", "use of force", "armed attack",
    "critical infrastructure", "due diligence", "state responsibility",
    "rules of engagement", "security council", "article 51",
    "necessity and proportionality", "proportionality", "necessity",
}

# British→American harmonization for frequent variants (not synonyms, just spelling)
_BRIT2AM: Dict[str, str] = {
    "defence": "defense",
    "behaviour": "behavior",
    "organisation": "organization",
    "organisational": "organizational",
    "authorisation": "authorization",
    "centre": "center",
    "labour": "labor",
    "signalling": "signaling",
}

_PUNCT_RX = re.compile(r"[^a-z0-9\s]")


def _build_meta_index_for_batches(df: Optional[pd.DataFrame]) -> Dict[str, Dict[str, Any]]:
    """
    Build a lookup: item_key -> {author_summary, first_author_last, year, title, source, url}
    Accepts dataframes where the key is in either 'item_key' or 'key'.
    Author precedence: author_summary > creator_summary (normalized into 'author_summary').
    """
    idx: Dict[str, Dict[str, Any]] = {}
    if df is None or not isinstance(df, pd.DataFrame) or df.empty:
        return idx

    key_col = "item_key" if "item_key" in df.columns else ("key" if "key" in df.columns else None)
    if not key_col:
        return idx

    def _clean_str(x) -> Optional[str]:
        if x is None:
            return None
        try:
            import pandas as _pd
            if isinstance(x, float) and _pd.isna(x):
                return None
        except Exception:
            pass
        s = str(x).strip()
        return s or None

    def _first_author_from_meta(md: Dict[str, Any]) -> Optional[str]:
        a_sum = _clean_str(md.get("author_summary"))
        if a_sum:
            parts = [p.strip() for p in re.split(r"[;|]", a_sum) if p.strip()] or [p.strip() for p in a_sum.split(",") if p.strip()]
            return parts[0] if parts else None
        for col in ("authors", "authors_list", "creator", "creators"):
            v = md.get(col)
            if isinstance(v, list) and v:
                head = v[0]
                if isinstance(head, dict):
                    given = _clean_str(head.get("given")) or ""
                    family = _clean_str(head.get("family")) or ""
                    nm = (family + (", " + (given[0] + ".") if given else "")).strip(", ")
                    return nm or None
                return _clean_str(head)
            if isinstance(v, dict):
                nm = _clean_str(v.get("name")) or _clean_str(v.get("family")) or _clean_str(v.get("author"))
                if nm:
                    return nm
            if isinstance(v, str) and v.strip():
                return v.strip().split(";")[0].strip()
        return None

    for _, r in df.iterrows():
        k = _clean_str(r.get(key_col))
        if not k:
            continue
        md: Dict[str, Any] = {}

        a_sum = _clean_str(r.get("author_summary"))
        c_sum = _clean_str(r.get("creator_summary"))
        if a_sum:
            md["author_summary"] = a_sum
        elif c_sum:
            md["author_summary"] = c_sum

        t = _clean_str(r.get("title"))
        if t: md["title"] = t

        y = _clean_str(r.get("year"))
        if y: md["year"] = y

        src = _clean_str(r.get("source")) or _clean_str(r.get("publicationTitle"))
        if src: md["source"] = src

        url = _clean_str(r.get("url")) or _clean_str(r.get("landing_page")) or _clean_str(r.get("doi_url"))
        if url: md["url"] = url

        md["first_author_last"] = _first_author_from_meta(md) or None
        md = {k2: v2 for k2, v2 in md.items() if v2 not in (None, "", [])}
        if md:
            idx[k] = md

    return idx

def _build_pdf_lookup_for_batches(df: Optional[pd.DataFrame]) -> Dict[str, str]:
    """
    Build a lookup: item_key -> normalized pdf_path from df['pdf_path'].
    - Supports either 'item_key' or 'key' as the primary key.
    - Normalizes Windows-style paths and expands '~'.
    - Skips empty values; does NOT require files to exist (existence checked later).
    """

    lookup: Dict[str, str] = {}
    if df is None or not isinstance(df, pd.DataFrame) or df.empty:
        return lookup

    key_col = "item_key" if "item_key" in df.columns else ("key" if "key" in df.columns else None)
    if not key_col or "pdf_path" not in df.columns:
        return lookup

    def _nn(s) -> Optional[str]:
        try:
            import pandas as _pd
            if s is None or (isinstance(s, float) and _pd.isna(s)):
                return None
        except Exception:
            if s is None:
                return None
        st = str(s).strip()
        return st or None

    for _, r in df.iterrows():
        k = _nn(r.get(key_col))
        p = _nn(r.get("pdf_path"))
        if not (k and p):
            continue
        norm = os.path.normpath(os.path.expanduser(p))
        lookup[k] = norm
    return lookup

def _normalize_direct_quote_lookup(dql) -> dict:
    """
    Ensure direct_quote_lookup is JSON-safe and matches what the HTML post-processor expects:
    return {dqid: quote_text}. If incoming keys are tuples like (item_key, dqid),
    keep only the dqid part as key.
    """
    out = {}
    if not isinstance(dql, dict):
        return out
    for k, v in dql.items():
        if isinstance(k, tuple):
            # Prefer the dqid if present as the 2nd element
            key_str = k[1] if len(k) >= 2 and isinstance(k[1], str) else "|".join(str(x) for x in k)
        else:
            key_str = str(k)
        out[key_str] = v
    return out
#
# def _enrich_batch_records_from_jobs(
#     jobs: list,
#     df: Optional[pd.DataFrame],
#     quote_hits: dict | None = None,
# ) -> Tuple[List[dict], Dict[str, int]]:
#     """
#     Build a flat list of evidence records (for export) from the batch jobs we sent
#     to Round-1.
#
#     This version is robust to BOTH:
#       - legacy shape: jobs == [ (job_dict, prompt_str), ... ]
#       - new shape:    jobs == [ job_dict, job_dict, ... ]
#
#     It also tolerates quote_hits in two shapes:
#       A) { item_key: { "<direct_quote_text>": { "page": 12, "section_title": "...", ... } } }
#       B) { item_key: 4, ... }   (just hit counts, no page data)
#     """
#
#
#     from concurrent.futures import ThreadPoolExecutor, as_completed
#
#     try:
#         from tqdm.auto import tqdm as _tqdm
#     except Exception:
#         _tqdm = None
#
#     # ---------------------------
#     # helpers copied / updated
#     # ---------------------------
#
#     def _score_bucket_of(rec: dict) -> str:
#         sb = rec.get("score_bucket")
#         if isinstance(sb, (int, str)) and str(sb).strip():
#             return str(sb).strip()
#         try:
#             v = int(float(rec.get("relevance_score", 5)))
#         except Exception:
#             v = 5
#         v = max(1, min(5, v))
#         return str(v)
#
#     def _mint_dqid(item_key: str, ev: dict) -> str:
#         import hashlib as _hash
#         anchor = (
#             ev.get("direct_quote")
#             or ev.get("paraphrase")
#             or ev.get("researcher_comment")
#             or ""
#         )
#         if not isinstance(anchor, str):
#             try:
#                 anchor = json.dumps(anchor, ensure_ascii=False)
#             except Exception:
#                 anchor = str(anchor)
#         anchor = anchor.strip()
#         base = f"{item_key}||{anchor}"
#         return _hash.md5(base.encode("utf-8")).hexdigest()[:10]
#
#     def _clean_quote(val) -> str:
#         # coerce any type (dict/list/etc) into a single-line string
#         if not isinstance(val, str):
#             try:
#                 val = json.dumps(val, ensure_ascii=False)
#             except Exception:
#                 val = str(val or "")
#         s = (
#             val.replace("“", '"').replace("”", '"')
#                .replace("’", "'").replace("‘", "'")
#         )
#         # collapse whitespace
#         return " ".join(s.split())
#
#     def _meta_fields(job_dict: dict) -> tuple[str, str, str, str]:
#         """
#         Extract rq_label, gold_theme, route_label, potential_theme_hint
#         from BOTH legacy job shape and new 'metadata' job shape.
#         """
#         md = job_dict.get("metadata", {}) or {}
#
#         rq_label = (
#             job_dict.get("rq_question")
#             or job_dict.get("rq")
#             or md.get("layer2_key")
#             or ""
#         )
#
#         gold_theme = (
#             job_dict.get("theme")
#             or job_dict.get("gold_theme")
#             or md.get("theme_label")
#             or "(merged_small_themes)"
#         )
#
#         route_label = (
#             job_dict.get("route")
#             or md.get("layer_structure")
#             or ""
#         )
#
#         potential_theme_hint = (
#             job_dict.get("potential_theme")
#             or ""
#         )
#
#         return (
#             str(rq_label).strip(),
#             str(gold_theme).strip() or "(merged_small_themes)",
#             str(route_label).strip(),
#             str(potential_theme_hint).strip(),
#         )
#
#     def _iter_payload_context(norm_jobs: list[tuple[dict, str]]):
#         """
#         Yield tuples that let worker build each evidence row.
#         Each norm_job is (job_dict, prompt_str).
#         """
#         for job_dict, _prompt_str in norm_jobs:
#             rq_label, gold_theme, route_label, pot_theme_hint = _meta_fields(job_dict)
#             for ev in (job_dict.get("payloads") or []):
#                 yield rq_label, gold_theme, route_label, pot_theme_hint, ev
#
#     # Normalize `jobs` into [(job_dict, prompt_str), ...]
#     norm_jobs: list[tuple[dict, str]] = []
#     for j in (jobs or []):
#         if isinstance(j, tuple):
#             # Legacy shape: (job_dict, prompt_str)
#             if len(j) >= 1 and isinstance(j[0], dict):
#                 job_dict = j[0]
#                 prompt_str = j[1] if len(j) > 1 and isinstance(j[1], str) else ""
#                 norm_jobs.append((job_dict, prompt_str))
#         elif isinstance(j, dict):
#             # New shape: just the job dict; pull some prompt-ish text if helpful
#             job_dict = j
#             prompt_str = (
#                 j.get("analysis_prompt")
#                 or j.get("prompt")
#                 or j.get("writer_prompt")
#                 or ""
#             )
#             norm_jobs.append((job_dict, prompt_str))
#         else:
#             # not something we understand, skip
#             continue
#
#     # Build static lookups once
#     meta_idx = _build_meta_index_for_batches(df)
#     pdf_lookup = _build_pdf_lookup_for_batches(df)
#
#     log: Dict[str, int] = {
#         "ready": 0,
#         "attempted": 0,
#         "succeeded": 0,
#         "failed": 0,
#         "missing_pdf": 0,
#         "missing_text": 0,
#         "file_not_found": 0,
#     }
#
#     # total number of evidence payload rows (for tqdm)
#     total_payloads = sum(
#         len((job_dict or {}).get("payloads") or [])
#         for (job_dict, _p) in norm_jobs
#     )
#
#     bar = (
#         _tqdm(
#             total=total_payloads,
#             desc="Hydrate from quote_hits",
#             unit="item",
#             dynamic_ncols=True,
#         )
#         if (_tqdm and total_payloads > 0)
#         else None
#     )
#
#     def _worker(rq_label, gold_theme, route_label, potential_theme_hint, ev):
#         """
#         Turn one evidence row (ev) + its job-level context into
#         a clean export record.
#         Also pulls page/section info if available.
#         """
#         local = {
#             "ready": 0,
#             "attempted": 0,
#             "succeeded": 0,
#             "failed": 0,
#             "missing_pdf": 0,
#             "missing_text": 0,
#             "file_not_found": 0,
#         }
#
#         item_key = (ev.get("item_key") or "").strip()
#         dqid = (ev.get("direct_quote_id") or _mint_dqid(item_key, ev))
#
#         ptheme = (
#             ev.get("theme")
#             or ev.get("potential_theme")
#             or potential_theme_hint
#             or ""
#         )
#         ptheme = ptheme.strip() or "(unspecified)"
#
#         etype = (ev.get("evidence_type") or "mixed").strip().lower()
#         sbucket = _score_bucket_of(ev)
#
#         # defaults; we try to enrich below
#         page = None
#         section_title = None
#         section_text = None
#
#         pdf_path = pdf_lookup.get(item_key)
#         direct_quote = _clean_quote(ev.get("direct_quote") or "")
#
#         if not direct_quote:
#             local["missing_text"] += 1
#         elif not pdf_path:
#             # We can't even say where in the PDF this came from
#             local["missing_pdf"] += 1
#         else:
#             # This evidence row is theoretically enrichable
#             local["ready"] += 1
#
#             if isinstance(quote_hits, dict):
#                 qh_item = quote_hits.get(item_key)
#                 if isinstance(qh_item, dict):
#                     hit = qh_item.get(direct_quote) or {}
#                     pg = hit.get("page")
#                     if isinstance(pg, int):
#                         page = pg
#                     section_title = hit.get("section_title")
#                     section_text = hit.get("section_html")
#
#                     local["attempted"] += 1
#                     # did we actually get anything?
#                     if (
#                         page is not None
#                         or (section_title not in (None, ""))
#                         or (section_text not in (None, ""))
#                     ):
#                         local["succeeded"] += 1
#                     else:
#                         local["failed"] += 1
#                 else:
#                     # qh_item was just an int count; no detail
#                     local["attempted"] += 1
#                     local["failed"] += 1
#             else:
#                 # no quote_hits structure at all
#                 local["failed"] += 1
#
#         rec = {
#             "rq": rq_label,
#             "rq_question": rq_label,
#             "gold_theme": gold_theme,
#             "overarching_theme": gold_theme,
#             "route": route_label,
#             "item_key": item_key,
#             "direct_quote_id": dqid,
#             "direct_quote": ev.get("direct_quote"),
#             "paraphrase": ev.get("paraphrase"),
#             "researcher_comment": ev.get("researcher_comment"),
#             "evidence_type": etype,
#             "evidence_type_norm": etype,
#             "potential_theme": ptheme,
#             "payload_theme": ptheme,
#             "score_bucket": sbucket,
#             "relevance_score": ev.get("relevance_score"),
#             "payload_json": json.dumps(ev, ensure_ascii=False),
#             "page": page,
#             "section_title": section_title,
#             "section_text": section_text,
#         }
#
#         # Add bibliographic/meta info from df if we have it
#         md = meta_idx.get(item_key, {})
#         if md:
#             if "author_summary" in md:
#                 rec["author_summary"] = md["author_summary"]
#             if "first_author_last" in md:
#                 rec["first_author_last"] = md["first_author_last"]
#             if "year" in md:
#                 rec["year"] = md["year"]
#             if "title" in md:
#                 rec["title"] = md["title"]
#             if "source" in md:
#                 rec["source"] = md["source"]
#             if "url" in md:
#                 rec["url"] = md["url"]
#
#         return rec, local
#
#     # ---------------------------
#     # Threaded fanout
#     # ---------------------------
#
#     max_workers = max(1, int(os.environ.get("PDF_FINDER_THREADS", "8")))
#     backlog_cap = max_workers * 8
#
#     records: List[dict] = []
#     futures = []
#
#     with ThreadPoolExecutor(max_workers=max_workers) as exe:
#         iterator = _iter_payload_context(norm_jobs)
#
#         # warm-start the queue
#         for _ in range(min(backlog_cap, total_payloads)):
#             try:
#                 futures.append(exe.submit(_worker, *next(iterator)))
#             except StopIteration:
#                 break
#
#         # streaming consumption / refill
#         for ctx in iterator:
#             if futures:
#                 for done in as_completed(futures, timeout=None):
#                     try:
#                         rec, local = done.result()
#                         records.append(rec)
#                         for k, v in local.items():
#                             log[k] += v
#                     except Exception:
#                         log["failed"] += 1
#                     if bar is not None:
#                         bar.update(1)
#                     futures.remove(done)
#                     break
#             futures.append(exe.submit(_worker, *ctx))
#
#         # drain leftovers
#         for done in as_completed(futures):
#             try:
#                 rec, local = done.result()
#                 records.append(rec)
#                 for k, v in local.items():
#                     log[k] += v
#             except Exception:
#                 log["failed"] += 1
#             if bar is not None:
#                 bar.update(1)
#
#     if bar is not None:
#         bar.close()
#
#     return records, log
def export_pyr_all_artifacts(
    jobs: List[Tuple[Dict[str, Any], str]],
    sections: List[Dict[str, Any]],
    out_dir: str,
    df: Any,
    basename_batches: str,
    basename_sections: str,
    r2_outputs: List[Dict[str, Any]],
    r2_sections: List[Dict[str, Any]],
    r2_merged_html: str,
    r3_outputs: List[Dict[str, Any]],
    r3_sections: List[Dict[str, Any]],
    r3_merged_html: str,
    quote_hits: Dict[str, Any],
    direct_quote_lookup: Optional[Dict[str, Any]] = None,
    inputs_modal: Optional[Dict[str, Any]] = None,
    inputs_grouped: Optional[Dict[str, Any]] = None,
    inputs_batches: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:


    """
    ###1. write L1 payload rows (json/jsonl/feather) with hydrated metadata, no nulls
    ###2. write L1 sections (json/html/feather) after hydration; ensure valid HTML
    ###3. write L1 paragraphs table exploded from hydrated sections
    ###4. write L2 outputs (json/feather) and L2 sections (json/feather) normalized; no nulls
    ###5. write merged L2 HTML; write L1 meta bundle with quote_hits
    ###6. return paths and row counts
    """
    import os, json
    from typing import Dict, Any, List, Tuple, Optional
    import pandas as pd
    from bs4 import BeautifulSoup

    os.makedirs(out_dir, exist_ok=True)

    # ---------- helpers ----------

    def _write_feather(df_obj: "pd.DataFrame", path: str) -> None:
        if not isinstance(df_obj, pd.DataFrame):
            return
        if not isinstance(path, str) or not path.strip():
            return

        df_clean = df_obj.copy()
        for col in df_clean.columns:
            if str(df_clean[col].dtype) == "object":
                df_clean[col] = df_clean[col].astype("string")

        tmp = path + ".tmp"
        df_clean.reset_index(drop=True).to_feather(tmp)
        os.replace(tmp, path)

    def _safe_json_write(path: str, obj: Any) -> None:
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False, indent=2)
        os.replace(tmp, path)

    def _norm_str(v: Any) -> str:
        if v is None:
            return ""
        return str(v)

    def _to_json_str(x: Any) -> str:
        return json.dumps(x, ensure_ascii=False)

    def _normalize_section_html(h: str) -> str:
        if not isinstance(h, str) or not h.strip():
            return ""
        soup = BeautifulSoup(h, "html.parser")
        for sec_tag in soup.find_all("section"):
            if not sec_tag.get("class"):
                sec_tag["class"] = ["pdf-section"]
        return str(soup)

    def _majority_evidence_type(records: List[dict]) -> str:
        counts: Dict[str, int] = {}
        for r in records or []:
            et_raw = r.get("evidence_type")
            et = et_raw.strip().lower() if isinstance(et_raw, str) else ""
            if not et:
                et = "mixed"
            counts[et] = counts.get(et, 0) + 1
        if not counts:
            return "mixed"
        return max(counts.items(), key=lambda kv: kv[1])[0]

    def _extract_job_meta(job: dict) -> dict:
        md = job.get("metadata") or {}
        if not isinstance(md, dict):
            md = {}
        rq_val = (md.get("layer2_key") or job.get("rq_question") or "").strip() or "(no RQ)"
        gold_theme_val = (md.get("theme_label") or job.get("theme") or "").strip() or "(merged_small_themes)"
        route_label = (md.get("layer_structure") or job.get("route") or "").strip() or "fallback"
        route_value = (md.get("route_value") or job.get("route_value") or "").strip()
        pot_theme_val = (job.get("potential_theme") or md.get("potential_theme") or "").strip() or "(unspecified)"
        evid_batch_fallback = job.get("evidence_type") or _majority_evidence_type(job.get("payloads") or []) or "mixed"
        return {
            "rq": rq_val,
            "gold_theme": gold_theme_val,
            "route": route_label,
            "route_value": route_value,
            "potential_theme": pot_theme_val,
            "evidence_type_fallback": evid_batch_fallback,
        }

    def _build_biblio_lookup(df_obj: Any) -> Dict[str, Dict[str, Any]]:
        out: Dict[str, Dict[str, Any]] = {}
        if isinstance(df_obj, pd.DataFrame):
            key_col = "item_key" if "item_key" in df_obj.columns else ("key" if "key" in df_obj.columns else None)
            if key_col:
                for _, r in df_obj.iterrows():
                    k = r.get(key_col)
                    if isinstance(k, str) and k.strip():
                        out[k] = {
                            "first_author_last": _norm_str(r.get("first_author_last") or r.get("author_last") or r.get("firstAuthorLast")),
                            "author_summary": _norm_str(r.get("author_summary") or r.get("authors")),
                            "title": _norm_str(r.get("title")),
                            "source": _norm_str(r.get("container_title") or r.get("publicationTitle") or r.get("source")),
                            "url": _norm_str(r.get("url") or r.get("URL")),
                            "year": _norm_str(r.get("year") or r.get("issued_year")),
                        }
        return out

    def _normalize_direct_quote_lookup(dq: Optional[Dict[str, Any]]) -> Dict[str, str]:
        out: Dict[str, str] = {}
        if isinstance(dq, dict):
            for k, v in dq.items():
                ks = _norm_str(k).strip()
                vs = _norm_str(v).strip()
                if ks and vs:
                    out[ks] = vs
        return out

    def _build_dq_lookup_from_jobs(pairs: List[Tuple[Dict[str, Any], str]]) -> Dict[str, str]:
        out: Dict[str, str] = {}
        for job_dict, _p in (pairs or []):
            payloads = job_dict.get("payloads") or []
            for ev in payloads:
                dqid = ev.get("direct_quote_id")
                dq = ev.get("direct_quote")
                if isinstance(dqid, str) and dqid and isinstance(dq, str) and dq:
                    if dqid not in out:
                        out[dqid] = dq
        return out

    # ------------------------------------------------------------------
    # STEP 1. PAYLOAD-LEVEL TABLE
    # ------------------------------------------------------------------
    # ------------------------------------------------------------------
    # STEP 1. PAYLOAD-LEVEL TABLE
    # ------------------------------------------------------------------
    # A0. RAW (unhydrated) snapshots for audit/reuse
    raw_dir = os.path.join(out_dir, "raw")
    os.makedirs(raw_dir, exist_ok=True)

    # flatten raw Round-1 payloads exactly as produced upstream (no hydration)
    raw_payloads: List[Dict[str, Any]] = []
    for (job_dict, _prompt_str) in (jobs or []):
        if isinstance(job_dict, dict):
            for ev in (job_dict.get("payloads") or []):
                if isinstance(ev, dict):
                    raw_payloads.append(dict(ev))

    _safe_json_write(os.path.join(raw_dir, f"{basename_batches}_raw.json"), raw_payloads)

    # raw Round-1 sections exactly as received (pre-hydration)
    _safe_json_write(os.path.join(raw_dir, f"{basename_sections}_raw.json"), list(sections or []))

    # raw Round-2 outputs and sections exactly as received
    _safe_json_write(os.path.join(raw_dir, "pyr_l2_outputs_raw.json"), list(r2_outputs or []))
    _safe_json_write(os.path.join(raw_dir, "pyr_l2_sections_raw.json"), list(r2_sections or []))

    # raw Round-3 outputs and sections exactly as received
    _safe_json_write(os.path.join(raw_dir, "pyr_l3_outputs_raw.json"), list(r3_outputs or []))
    _safe_json_write(os.path.join(raw_dir, "pyr_l3_sections_raw.json"), list(r3_sections or []))

    # proceed with hydrated/exported artifacts
    quote_hits_map = quote_hits or {}
    enriched_records: List[Dict[str, Any]] = []
    for (job_dict, _prompt_str) in (jobs or []):
        payloads = job_dict.get("payloads") or []
        for ev in payloads:
            if isinstance(ev, dict):
                enriched_records.append(ev)

    ordered_cols = [
        "rq",
        "rq_question",
        "gold_theme",
        "overarching_theme",
        "route",
        "item_key",
        "direct_quote_id",
        "direct_quote",
        "paraphrase",
        "researcher_comment",
        "evidence_type",
        "evidence_type_norm",
        "potential_theme",
        "payload_theme",
        "score_bucket",
        "relevance_score",
        "payload_json",
        "page",
        "section_title",
        "section_text",
        "author_summary",
        "first_author_last",
        "year",
        "title",
        "source",
        "url",
    ]

    if enriched_records:
        df_batches = pd.DataFrame.from_records(enriched_records)
        for col in ordered_cols:
            if col not in df_batches.columns:
                df_batches[col] = ""
        df_batches = df_batches[ordered_cols]
        df_batches = df_batches.fillna("")
    else:
        df_batches = pd.DataFrame(columns=ordered_cols)

    # write pyr_l1_batches.json/jsonl mirroring the upstream payload schema,
    # now with page / section_title / section_text hydrated from PDFs
    def _s(v):
        if v is None:
            return ""
        return v if isinstance(v, str) else str(v)

    batches_json_rows: List[Dict[str, Any]] = []
    for rec in (enriched_records or []):
        apt = rec.get("all_potential_themes")
        if not isinstance(apt, list):
            acc: List[str] = []
            for cand in (rec.get("potential_theme"), rec.get("theme"), rec.get("payload_theme")):
                s = _s(cand)
                if s and s not in acc:
                    acc.append(s)
            apt = acc

        rq_q = _s(rec.get("rq_question") or rec.get("rq"))
        ov_theme = _s(rec.get("overarching_theme") or rec.get("gold_theme"))
        route_val = _s(rec.get("route"))
        gold_val = _s(rec.get("gold_theme"))

        payload = {
            "direct_quote_id": _s(rec.get("direct_quote_id")),
            "direct_quote": _s(rec.get("direct_quote")),
            "paraphrase": _s(rec.get("paraphrase")),
            "researcher_comment": _s(rec.get("researcher_comment")),
            "evidence_type": _s(rec.get("evidence_type") or rec.get("evidence_type_norm") or "mixed").lower(),
            "theme": _s(rec.get("payload_theme") or rec.get("theme") or rec.get("potential_theme")),
            "potential_theme": _s(rec.get("potential_theme")),
            "item_key": _s(rec.get("item_key")),
            "author_summary": _s(rec.get("author_summary")),
            "first_author_last": _s(rec.get("first_author_last")),
            "author": "",
            "year": _s(rec.get("year")),
            "title": _s(rec.get("title")),
            "source": _s(rec.get("source")),
            "url": _s(rec.get("url")),
            "page": _s(rec.get("page")),
            "section_title": _s(rec.get("section_title")),
            "section_text": _s(rec.get("section_text")),
            "score_bucket": _s(rec.get("score_bucket")),
            "relevance_score": rec.get("relevance_score"),
            "payload_json": _s(rec.get("payload_json")),
            "all_potential_themes": apt,
            "route": route_val,
            "route_value": _s(rec.get("route_value")),  # include route_value
            "gold_theme": gold_val,
            "_rq_question": rq_q,
            "_overarching_theme": ov_theme,
        }

        batches_json_rows.append(payload)

    batches_json_path = os.path.join(out_dir, f"{basename_batches}.json")
    _safe_json_write(batches_json_path, batches_json_rows)

    batches_jsonl_path = os.path.join(out_dir, f"{basename_batches}.jsonl")
    tmp_jsonl = batches_jsonl_path + ".tmp"
    with open(tmp_jsonl, "w", encoding="utf-8") as f:
        for row in batches_json_rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    os.replace(tmp_jsonl, batches_jsonl_path)

    batches_feather_path = os.path.join(out_dir, f"{basename_batches}.feather")
    _write_feather(df_batches, batches_feather_path)


    # ------------------------------------------------------------------
    # STEP 2. ROUND-1 SECTIONS (hydrated HTML with APA anchors)
    # ------------------------------------------------------------------
    # Pre-hydrate: inject direct-quote titles + APA into section HTML using df and the dq lookup
    def _build_dq_lookup_from_jobs(pairs: List[Tuple[Dict[str, Any], str]]) -> Dict[str, str]:
        out: Dict[str, str] = {}
        for job_dict, _p in (pairs or []):
            payloads = job_dict.get("payloads") or []
            for ev in payloads:
                dqid = ev.get("direct_quote_id")
                dq = ev.get("direct_quote")
                if isinstance(dqid, str) and dqid and isinstance(dq, str) and dq:
                    if dqid not in out:
                        out[dqid] = dq
        return out

    # ------------------------------------------------------------------
    # STEP 2. ROUND-1 SECTIONS (hydrate → save JSON/HTML/FEATHER) with strict keys
    # ------------------------------------------------------------------
    dq_lookup_effective = (
        _normalize_direct_quote_lookup(direct_quote_lookup)
        if isinstance(direct_quote_lookup, dict) and direct_quote_lookup
        else _build_dq_lookup_from_jobs(jobs)
    )

    sections = hydrate_sections_records(
        sections=sections,
        df=df,
        dq_lookup=dq_lookup_effective,
    )

    hydrated_sections: List[dict] = []
    for sec in (sections or []):
        meta = sec.get("meta") or {}
        sec_html_norm = _normalize_section_html(sec.get("section_html"))

        hydrated_sections.append({
            "custom_id": meta.get("custom_id") or sec.get("custom_id") or "",
            "meta": {
                "custom_id": meta.get("custom_id") or "",
                "rq": meta.get("rq") or "",
                "gold_theme": meta.get("gold_theme") or "",
                "potential_theme": meta.get("potential_theme") or "",
                "evidence_type": meta.get("evidence_type") or "",
                "route": meta.get("route") or "",
                "route_value": meta.get("route_value") or "",
                "page": meta.get("page") or "",
                "section_title": meta.get("section_title") or "",
                "section_text": meta.get("section_text") or "",
                "item_key": meta.get("item_key") or "",
                "url": meta.get("url") or "",
            },
            "section_html": sec_html_norm,
        })

    sections_json_path = os.path.join(out_dir, f"{basename_sections}.json")
    _safe_json_write(sections_json_path, hydrated_sections)

    # merged HTML for pretty viewer (from hydrated section_html only)
    html_blocks_round1: List[str] = []
    for rec in hydrated_sections:
        block = rec.get("section_html") or ""
        if isinstance(block, str) and block.strip():
            html_blocks_round1.append(block)
    joined_html_round1 = "\n\n".join(html_blocks_round1)

    def _render_academic_css() -> str:
        return """
    :root{
      --bg:#ffffff;--fg:#111827;--muted:#6b7280;--accent:#0f766e;--link:#0a66c2;--card:#f8fafc;--border:#e5e7eb
    }
    @media (prefers-color-scheme: dark){
      :root{--bg:#0b0f17;--fg:#e5e7eb;--muted:#94a3b8;--accent:#14b8a6;--link:#60a5fa;--card:#0f1624;--border:#1f2937}
    }
    *{box-sizing:border-box}
    html{scroll-behavior:smooth}
    body{margin:0;padding:2rem 1rem 4rem;background:var(--bg);color:var(--fg);font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;line-height:1.6}
    .container{max-width:1000px;margin:0 auto}
    .header{margin-bottom:1.25rem;border-bottom:1px solid var(--border);padding-bottom:.75rem}
    .header .kicker{letter-spacing:.02em;text-transform:uppercase;font-size:.8rem;color:var(--muted)}
    .header h1{margin:.25rem 0;font-size:1.6rem}
    .meta{display:flex;gap:.75rem;flex-wrap:wrap;color:var(--muted);font-size:.9rem}
    .card{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:1.1rem 1.2rem;margin:1rem 0 1.5rem;box-shadow:0 1px 2px rgba(0,0,0,.05)}
    section.pdf-section{margin:0 0 1rem}
    section.pdf-section>h2{font-size:1.25rem;margin:.25rem 0}
    section.pdf-section>h3{font-size:1.05rem;color:var(--muted);margin:.25rem 0}
    p{margin:.7rem 0}
    a{color:var(--link);text-decoration:none;border-bottom:1px solid transparent}
    a:hover{border-color:var(--link)}
    a[data-key][data-quote-id]{display:inline-block;width:.85rem;height:.85rem;transform:translateY(-1px);border-radius:2px;background:var(--accent);opacity:.85}
    a[data-key][data-quote-id]:hover{opacity:1}
    table{width:100%;border-collapse:collapse}
    th,td{border-bottom:1px solid var(--border);text-align:left;padding:.5rem .4rem;vertical-align:top}
    th{font-weight:600}
    .badge{display:inline-block;background:var(--accent);color:#fff;padding:.1rem .4rem;border-radius:.4rem;font-size:.75rem}
    .footer{margin-top:2rem;color:var(--muted);font-size:.9rem;border-top:1px solid var(--border);padding-top:1rem}
    """  # noqa: E501

    def _render_page(title: str, body_html: str, kicker: str) -> str:
        css = _render_academic_css()
        return (
            "<!doctype html><html lang='en'><head>"
            "<meta charset='utf-8'/>"
            "<meta name='viewport' content='width=device-width, initial-scale=1'/>"
            f"<title>{title}</title>"
            f"<style>{css}</style>"
            "</head><body>"
            "<div class='container'>"
            "<header class='header'>"
            f"<div class='kicker'>{kicker}</div>"
            f"<h1>{title}</h1>"
            "<div class='meta'><span>Generated by Pyramid</span><span>Academic format</span></div>"
            "</header>"
            f"<main class='card'>{body_html}</main>"
            "<div class='footer'><p>Citation anchors are compact squares; hover to see verbatim direct quotes in the title attribute.</p></div>"
            "</div></body></html>"
        )

    # ---------- A) L1 sections HTML (pretty viewer) ----------
    sections_html_path = os.path.join(out_dir, f"{basename_sections}.html")
    tmp_html1 = sections_html_path + ".tmp"
    html_doc_l1 = _render_page("Round-1 Sections", joined_html_round1, "Round-1")
    with open(tmp_html1, "w", encoding="utf-8") as f:
        f.write(html_doc_l1)
    os.replace(tmp_html1, sections_html_path)

    # ---------- B) Batches HTML (payload table) ----------
    batches_html_path = os.path.join(out_dir, f"{basename_batches}.html")
    tmp_html_b = batches_html_path + ".tmp"
    cols = [
        "rq", "gold_theme", "evidence_type", "direct_quote", "paraphrase",
        "first_author_last", "year", "title", "source", "item_key"
    ]
    cols = [c for c in cols if c in df_batches.columns]
    rows = df_batches[cols].to_dict(orient="records") if cols else []
    table_head = "<thead><tr>" + "".join(f"<th>{c}</th>" for c in cols) + "</tr></thead>"
    table_body = "<tbody>" + "".join(
        "<tr>" + "".join(f"<td>{(r.get(c) or '')}</td>" for c in cols) + "</tr>"
        for r in rows
    ) + "</tbody>"
    table_html = f"<table>{table_head}{table_body}</table>"
    html_doc_batches = _render_page("Payload Batches", table_html, "Evidence rows")
    with open(tmp_html_b, "w", encoding="utf-8") as f:
        f.write(html_doc_batches)
    os.replace(tmp_html_b, batches_html_path)

    # ---------- C) L2 sections HTML (stitched synthesis blocks) ----------
    r2_sections_html_path = os.path.join(out_dir, "pyr_l2_sections.html")
    tmp_html_c = r2_sections_html_path + ".tmp"
    l2_blocks: List[str] = []

    # compute a local normalised copy; do not rely on external name
    local_norm_r2_sections: List[Dict[str, Any]] = []
    for sec in (r2_sections or []):
        meta2 = sec.get("meta") or {}
        local_norm_r2_sections.append({
            "meta": meta2,
            "section_html": _normalize_section_html(sec.get("section_html")),
        })

    for rec in local_norm_r2_sections:
        meta = rec.get("meta") or {}
        hdr = (
            "<div style='margin:.25rem 0 .5rem'>"
            f"<span class='badge'>{meta.get('rq', '')}</span> "
            f"<span class='badge'>{meta.get('gold_theme', '')}</span> "
            f"<span class='badge'>{meta.get('route_value', '')}</span>"
            "</div>"
        )
        l2_blocks.append(hdr + (rec.get("section_html") or ""))

    joined_html_l2 = "\n".join(l2_blocks)
    html_doc_l2 = _render_page("Round-2 Sections", joined_html_l2, "Round-2")
    with open(tmp_html_c, "w", encoding="utf-8") as f:
        f.write(html_doc_l2)
    os.replace(tmp_html_c, r2_sections_html_path)

    # ---------- D) keep merged L2 storyline HTML ----------
    r2_merged_html_path = None
    if isinstance(r2_merged_html, str):
        r2_merged_html_path = os.path.join(out_dir, "pyr_l2_merged.html")
        tmp_html2 = r2_merged_html_path + ".tmp"
        with open(tmp_html2, "w", encoding="utf-8") as f:
            f.write(r2_merged_html)
        os.replace(tmp_html2, r2_merged_html_path)

    # tabular projection for analysis
    sec_rows = []
    for rec in hydrated_sections:
        meta = rec.get("meta") or {}
        sec_rows.append({
            "custom_id": rec.get("custom_id") or meta.get("custom_id") or "",
            "rq": meta.get("rq") or "",
            "gold_theme": meta.get("gold_theme") or "",
            "potential_theme": meta.get("potential_theme") or "",
            "evidence_type": meta.get("evidence_type") or "",
            "route": meta.get("route") or "",
            "section_html": rec.get("section_html") or "",
            "meta_json": _to_json_str(meta),
        })

    if sec_rows:
        df_sec = pd.DataFrame.from_records(
            sec_rows,
            columns=[
                "custom_id", "rq", "gold_theme", "potential_theme",
                "evidence_type", "route", "section_html", "meta_json"
            ],
        ).fillna("")
    else:
        df_sec = pd.DataFrame(
            columns=[
                "custom_id", "rq", "gold_theme", "potential_theme",
                "evidence_type", "route", "section_html", "meta_json"
            ]
        )

    sections_feather_path = os.path.join(out_dir, f"{basename_sections}.feather")
    _write_feather(df_sec, sections_feather_path)

    # verification evidence
    viol_keys = 0
    viol_html = 0
    sample_evidence: List[dict] = []
    for i, rec in enumerate(hydrated_sections):
        keys_ok = set(rec.keys()) == {"custom_id", "meta", "section_html"}
        if not keys_ok:
            viol_keys += 1
        html_str = rec.get("section_html") or ""
        if isinstance(html_str, str) and ("section_text" in html_str):
            viol_html += 1
        if len(sample_evidence) < 3:
            sample_evidence.append({
                "custom_id": rec.get("custom_id"),
                "meta_keys": sorted(list((rec.get("meta") or {}).keys())),
                "contains_section_text_in_html": ("section_text" in (rec.get("section_html") or "")),
            })

    print(
        f"[VERIFY] sections.json records={len(hydrated_sections)} keys_violations={viol_keys} html_section_text_hits={viol_html}")
    print(f"[VERIFY] samples={_to_json_str(sample_evidence)}")
    print(f"[SAVE] R1 sections → {sections_json_path} ({len(df_sec)} rows)")

    # ------------------------------------------------------------------
    # STEP 3. PARAGRAPHS TABLE (explode section_html <p> blocks)
    # ------------------------------------------------------------------

    par_rows: List[dict] = []
    for rec in (hydrated_sections or []):
        meta = rec.get("meta") or {}
        html_block = rec.get("section_html") or ""
        if not isinstance(html_block, str) or not html_block.strip():
            continue

        soup = BeautifulSoup(html_block, "html.parser")
        for p in soup.find_all("p"):
            tags_attr = p.get("data-tags")
            tags_str = None
            if isinstance(tags_attr, str) and tags_attr.strip():
                tags_clean = [t.strip() for t in tags_attr.split(";") if t.strip()]
                if tags_clean:
                    tags_str = ";".join(tags_clean)

            par_rows.append({
                "custom_id": (rec.get("custom_id") or meta.get("custom_id") or None),
                "paragraph_id": p.get("id"),
                "tags": tags_str,
                "paragraph_html": str(p),
                "meta_json": _to_json_str(meta),
            })

    paragraphs_json_path = os.path.join(out_dir, f"{basename_sections}_paragraphs.json")
    _safe_json_write(paragraphs_json_path, par_rows)

    if par_rows:
        df_par = pd.DataFrame.from_records(
            par_rows,
            columns=[
                "custom_id",
                "paragraph_id",
                "tags",
                "paragraph_html",
                "meta_json",
            ],
        )
    else:
        df_par = pd.DataFrame(
            columns=[
                "custom_id",
                "paragraph_id",
                "tags",
                "paragraph_html",
                "meta_json",
            ],
        )

    paragraphs_feather_path = os.path.join(out_dir, f"{basename_sections}_paragraphs.feather")
    _write_feather(df_par, paragraphs_feather_path)

    # ❗ fixed here: use len(df_par) not len[df_par]
    print(f"[SAVE] paragraphs JSON → {paragraphs_json_path} ({len(df_par)} rows)")
    print(f"[SAVE] paragraphs FEAT → {paragraphs_feather_path}")

    # ------------------------------------------------------------------
    # STEP 4. ROUND-2 OUTPUTS (prompt → r2 synthesis block)
    # ------------------------------------------------------------------

    if r2_outputs is None:
        r2_outputs = []

    r2_outputs_json_path = os.path.join(out_dir, "pyr_l2_outputs.json")
    _safe_json_write(r2_outputs_json_path, r2_outputs)

    if r2_outputs:
        df_r2 = pd.DataFrame.from_records(r2_outputs)
    else:
        df_r2 = pd.DataFrame(
            columns=[
                "custom_id",
                "prompt",
                "payload_size",
                "response_html",
                "processed_html",
            ],
        )

    r2_outputs_feather_path = os.path.join(out_dir, "pyr_l2_outputs.feather")
    _write_feather(df_r2, r2_outputs_feather_path)

    print(f"[SAVE] R2 outputs JSON → {r2_outputs_json_path} ({len(df_r2)} rows)")
    print(f"[SAVE] R2 outputs FEAT → {r2_outputs_feather_path}")

    # ------------------------------------------------------------------
    # STEP 5. ROUND-2 SECTIONS (cleaned merged synthesis per rq/theme/etc.)
    # ------------------------------------------------------------------

    if r2_sections is None:
        r2_sections = []

    norm_r2_sections: List[dict] = []
    for sec in (r2_sections or []):
        meta2 = sec.get("meta") or {}
        sec_html_norm = _normalize_section_html(sec.get("section_html"))
        norm_r2_sections.append({
            "meta": meta2,
            "section_html": sec_html_norm,
        })

    r2_sections_json_path = os.path.join(out_dir, "pyr_l2_sections.json")
    _safe_json_write(r2_sections_json_path, norm_r2_sections)

    r2_sec_rows = []
    for sec in norm_r2_sections:
        meta2 = sec.get("meta") or {}
        r2_sec_rows.append({
            "custom_id": meta2.get("custom_id"),
            "rq": meta2.get("rq"),
            "gold_theme": meta2.get("gold_theme"),
            "potential_theme": meta2.get("potential_theme"),
            "evidence_type": meta2.get("evidence_type"),
            "route": meta2.get("route"),
            "section_html": sec.get("section_html"),
            "meta_json": _to_json_str(meta2),
        })

    if r2_sec_rows:
        df_r2_sec = pd.DataFrame.from_records(
            r2_sec_rows,
            columns=[
                "custom_id",
                "rq",
                "gold_theme",
                "potential_theme",
                "evidence_type",
                "route",
                "section_html",
                "meta_json",
            ],
        )
    else:
        df_r2_sec = pd.DataFrame(
            columns=[
                "custom_id",
                "rq",
                "gold_theme",
                "potential_theme",
                "evidence_type",
                "route",
                "section_html",
                "meta_json",
            ],
        )

    r2_sections_feather_path = os.path.join(out_dir, "pyr_l2_sections.feather")
    _write_feather(df_r2_sec, r2_sections_feather_path)

    print(f"[SAVE] R2 sections JSON → {r2_sections_json_path} ({len(df_r2_sec)} rows)")
    print(f"[SAVE] R2 sections FEAT → {r2_sections_feather_path}")

    # ------------------------------------------------------------------
    # STEP 6. MERGED ROUND-2 HTML (full stitched storyline)
    # ------------------------------------------------------------------

    r2_merged_html_path = None
    if isinstance(r2_merged_html, str):
        r2_merged_html_path = os.path.join(out_dir, "pyr_l2_merged.html")
        tmp_html2 = r2_merged_html_path + ".tmp"
        with open(tmp_html2, "w", encoding="utf-8") as f:
            f.write(r2_merged_html)
        os.replace(tmp_html2, r2_merged_html_path)
        print(f"[SAVE] merged Round-2 HTML → {r2_merged_html_path}")

    # ------------------------------------------------------------------
    # STEP 7. ROUND-3 OUTPUTS (prompt → r3 synthesis block)
    # ------------------------------------------------------------------

    if r3_outputs is None:
        r3_outputs = []

    r3_outputs_json_path = os.path.join(out_dir, "pyr_l3_outputs.json")
    _safe_json_write(r3_outputs_json_path, r3_outputs)

    if r3_outputs:
        df_r3 = pd.DataFrame.from_records(r3_outputs)
    else:
        df_r3 = pd.DataFrame(
            columns=[
                "custom_id",
                "prompt",
                "payload_size",
                "response_html",
                "processed_html",
            ],
        )

    r3_outputs_feather_path = os.path.join(out_dir, "pyr_l3_outputs.feather")
    _write_feather(df_r3, r3_outputs_feather_path)

    print(f"[SAVE] R3 outputs JSON → {r3_outputs_json_path} ({len(df_r3)} rows)")
    print(f"[SAVE] R3 outputs FEAT → {r3_outputs_feather_path}")

    # ------------------------------------------------------------------
    # STEP 8. ROUND-3 SECTIONS (cleaned merged synthesis per rq/theme/etc.)
    # ------------------------------------------------------------------

    if r3_sections is None:
        r3_sections = []

    norm_r3_sections: List[dict] = []
    for sec in (r3_sections or []):
        meta3 = sec.get("meta") or {}
        sec_html_norm3 = _normalize_section_html(sec.get("section_html"))
        norm_r3_sections.append({
            "meta": meta3,
            "section_html": sec_html_norm3,
        })

    r3_sections_json_path = os.path.join(out_dir, "pyr_l3_sections.json")
    _safe_json_write(r3_sections_json_path, norm_r3_sections)

    r3_sec_rows = []
    for sec in norm_r3_sections:
        meta3 = sec.get("meta") or {}
        r3_sec_rows.append({
            "custom_id": meta3.get("custom_id"),
            "rq": meta3.get("rq"),
            "gold_theme": meta3.get("gold_theme"),
            "potential_theme": meta3.get("potential_theme"),
            "evidence_type": meta3.get("evidence_type"),
            "route": meta3.get("route"),
            "section_html": sec.get("section_html"),
            "meta_json": _to_json_str(meta3),
        })

    if r3_sec_rows:
        df_r3_sec = pd.DataFrame.from_records(
            r3_sec_rows,
            columns=[
                "custom_id",
                "rq",
                "gold_theme",
                "potential_theme",
                "evidence_type",
                "route",
                "section_html",
                "meta_json",
            ],
        )
    else:
        df_r3_sec = pd.DataFrame(
            columns=[
                "custom_id",
                "rq",
                "gold_theme",
                "potential_theme",
                "evidence_type",
                "route",
                "section_html",
                "meta_json",
            ],
        )

    r3_sections_feather_path = os.path.join(out_dir, "pyr_l3_sections.feather")
    _write_feather(df_r3_sec, r3_sections_feather_path)

    print(f"[SAVE] R3 sections JSON → {r3_sections_json_path} ({len(df_r3_sec)} rows)")
    print(f"[SAVE] R3 sections FEAT → {r3_sections_feather_path}")

    # ------------------------------------------------------------------
    # STEP 9. MERGED ROUND-3 HTML (full stitched storyline)
    # ------------------------------------------------------------------

    r3_merged_html_path = None
    if isinstance(r3_merged_html, str):
        r3_merged_html_path = os.path.join(out_dir, "pyr_l3_merged.html")
        tmp_html3 = r3_merged_html_path + ".tmp"
        with open(tmp_html3, "w", encoding="utf-8") as f:
            f.write(r3_merged_html)
        os.replace(tmp_html3, r3_merged_html_path)
        print(f"[SAVE] merged Round-3 HTML → {r3_merged_html_path}")

    # ------------------------------------------------------------------
    # STEP 7. quote_hits bundle (debug info for R1 sections)
    # ------------------------------------------------------------------

    bundle_path = os.path.join(out_dir, f"{basename_sections}_meta.json")
    bundle_obj = {
        "sections": hydrated_sections,
        "quote_hits": {str(k): int(v) for (k, v) in quote_hits_map.items()},
    }
    _safe_json_write(bundle_path, bundle_obj)

    # # STEP 8.
    # # STEP 8.
    # dql_path = os.path.join(out_dir, "direct_quote_lookup.json")
    # with open(dql_path, "w", encoding="utf-8") as f:
    #     json.dump(dq_lookup_effective, f, ensure_ascii=False, indent=2)
    #
    # qh_path = os.path.join(out_dir, "quote_hits.json")
    # with open(qh_path, "w", encoding="utf-8") as f:
    #     json.dump(dict(quote_hits), f, ensure_ascii=False, indent=2)

    # STEP 9. inputs snapshot (moved from process_widget_data)
    inputs_dir = os.path.join(out_dir, "inputs")
    os.makedirs(inputs_dir, exist_ok=True)

    if isinstance(inputs_modal, dict):
        with open(os.path.join(inputs_dir, "AI_MODAL_RESULT.json"), "w", encoding="utf-8") as f:
            json.dump(inputs_modal, f, ensure_ascii=False, indent=2)

    if isinstance(inputs_grouped, dict):
        with open(os.path.join(inputs_dir, "GROUPED.json"), "w", encoding="utf-8") as f:
            json.dump(inputs_grouped, f, ensure_ascii=False, indent=2)

    if isinstance(inputs_batches, dict):
        with open(os.path.join(inputs_dir, "AI_BATCHES.json"), "w", encoding="utf-8") as f:
            json.dump(inputs_batches, f, ensure_ascii=False, indent=2)

    hydrated_batches_path = os.path.join(inputs_dir, "AI_BATCHES_HYDRATED.json")
    with open(hydrated_batches_path, "w", encoding="utf-8") as f:
        json.dump(
            {"batches": [{**job, "analysis_prompt": prompt} for (job, prompt) in (jobs or [])]},
            f,
            ensure_ascii=False,
            indent=2,
        )

    # ------------------------------------------------------------------
    # RETURN PATHS / COUNTS
    # ------------------------------------------------------------------
    export_paths = {
        "batches_json": batches_json_path,
        "batches_jsonl": batches_jsonl_path,
        "batches_feather": batches_feather_path,
        "l1_sections_json": sections_json_path,
        "l1_sections_html": sections_html_path,
        "l1_sections_feather": sections_feather_path,
        "paragraphs_json": paragraphs_json_path,
        "paragraphs_feather": paragraphs_feather_path,
        "r2_outputs_json": r2_outputs_json_path,
        "r2_outputs_feather": r2_outputs_feather_path,
        "r2_sections_json": r2_sections_json_path,
        "r2_sections_feather": r2_sections_feather_path,
        "r2_merged_html": r2_merged_html_path,
        "r3_outputs_json": r3_outputs_json_path,
        "r3_outputs_feather": r3_outputs_feather_path,
        "r3_sections_json": r3_sections_json_path,
        "r3_sections_feather": r3_sections_feather_path,
        "r3_merged_html": r3_merged_html_path,
        "l1_meta_bundle": bundle_path,
        "num_batches": len(df_batches),
        "num_sections": len(df_sec),
        "num_paragraphs": len(df_par),
        "num_r2_outputs": len(df_r2),
        "num_r2_sections": len(df_r2_sec),
        "num_r3_outputs": len(df_r3),
        "num_r3_sections": len(df_r3_sec),
    }


    print("[EXPORT PATHS]", json.dumps(export_paths, ensure_ascii=False, indent=2))
    return export_paths







# ------------------------- Text normalization & helpers -------------------------

def _harmonize(sp: str) -> str:
    """
    Lowercase, normalize dashes, map BrE→AmE spellings, strip punctuation to spaces, collapse whitespace.
    """
    s = (sp or "").lower()
    s = s.replace("–", "-").replace("—", "-").replace("\u00a0", " ")
    for b, a in _BRIT2AM.items():
        s = re.sub(rf"\b{re.escape(b)}\b", a, s)
    s = _PUNCT_RX.sub(" ", s)
    return " ".join(s.split())

def _tokens_for(sp: str) -> List[str]:
    """
    Tokenize to content tokens for candidate gating:
      - harmonize
      - split
      - drop stopwords
      - light singularization
    """
    s = _harmonize(sp)
    toks: List[str] = []
    for t in s.split():
        if t in _STOPWORDS:
            continue
        if len(t) > 4 and t.endswith("ies"):
            t = t[:-3] + "y"
        elif len(t) > 4 and t.endswith("es"):
            t = t[:-2]
        elif len(t) > 3 and t.endswith("s"):
            t = t[:-1]
        toks.append(t)
    return toks

def _guard_set(sp: str) -> Set[str]:
    """Return guard phrases present in the string (normalized)."""
    s = " " + _harmonize(sp) + " "
    found = set()
    for p in _GUARD_PHRASES:
        p_norm = " " + _harmonize(p) + " "
        if p_norm in s:
            found.add(p.strip())
    return found

def _similar(a: str, b: str) -> float:
    """Character-level similarity (SequenceMatcher)."""
    return difflib.SequenceMatcher(None, a, b).ratio()

def _choose_display(variants_counter: Counter) -> str:
    """
    Pick the most common original variant; tie-break by longer string.
    """
    if not variants_counter:
        return ""
    return max(variants_counter.items(), key=lambda kv: (kv[1], len(kv[0])))[0]

def _stable_cluster_id(canon_terms: List[str]) -> str:
    """
    Stable ID for a cluster of canonicalized terms.
    Deterministic across runs for the same member set.
    """
    key = "||".join(sorted(set(canon_terms)))
    h = hashlib.md5(key.encode("utf-8")).hexdigest()[:10]
    return f"th_{h}"

def _chunk(lst: List[Any], size: int) -> List[List[Any]]:
    size = max(1, int(size))
    return [lst[i: i + size] for i in range(0, len(lst), size)]


# ------------------------- Disjoint Set Union -------------------------

class _DSU:
    """Union-Find for clustering."""
    def __init__(self, n: int):
        self.p = list(range(n))
        self.r = [0] * n

    def find(self, x: int) -> int:
        while self.p[x] != x:
            self.p[x] = self.p[self.p[x]]
            x = self.p[x]
        return x

    def union(self, a: int, b: int) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra == rb:
            return
        if self.r[ra] < self.r[rb]:
            self.p[ra] = rb
        elif self.r[rb] < self.r[ra]:
            self.p[rb] = ra
        else:
            self.p[rb] = ra
            self.r[ra] += 1


# ------------------------- Embeddings backend -------------------------

# Load once (prevents repeated model loads in logs)
_SBERT_MODEL = SentenceTransformer("all-MiniLM-L6-v2", device=DEVICE)

KNN_K = 15                # neighbors per item for the embedding k-NN candidate stage
HEADWORD_EMB_BONUS = 0.03 # shared headword lowers the embedding gate by this amount

class _EmbeddingVectors:
    """
    Holds vectors and a similarity function. Vectors are L2-normalized so dot = cosine.
    Supports:
      - dense numpy arrays
      - sklearn sparse matrices
      - pure-Python list[dict[str,float]] (already L2-normalized)
    """
    def __init__(self, name: str):
        self.name = name
        self._vectors = None
        self._sparse = False  # True if using sklearn sparse matrices

    def set_dense(self, mat):
        self._vectors = mat
        self._sparse = False

    def set_sparse(self, mat):
        self._vectors = mat
        self._sparse = True

    def similarity(self, i: int, j: int) -> float:
        v = self._vectors
        if not self._sparse and hasattr(v, "shape"):  # dense
            return float((v[i] * v[j]).sum())
        if self._sparse and hasattr(v[i], "multiply"):  # sparse
            return float(v[i].multiply(v[j]).sum())
        # pure-python dict-of-weights (already L2-normalized)
        di = v[i]
        dj = v[j]
        if len(di) > len(dj):
            di, dj = dj, di
        s = 0.0
        for k, w in di.items():
            s += w * dj.get(k, 0.0)
        return s
def _item_count(it: Dict[str, Any]) -> int:
    try:
        return int(it.get("count", 0))
    except Exception:
        return 0

def _sort_inventory_desc(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    # High count first; deterministic tie-breaker on theme string.
    return sorted(
        items,
        key=lambda it: (-_item_count(it), str(it.get("theme", "")))
    )

def build_sorted_batches_from_inventory(
    items: List[Dict[str, Any]],
    batch_size: int
) -> List[List[Dict[str, Any]]]:
    items_sorted = _sort_inventory_desc(items)
    return _chunk(items_sorted, batch_size)  # leave _chunk as-is


def _build_embeddings(texts: List[str], backend: str = "sbert") -> Tuple[_EmbeddingVectors, float]:
    """
    Build embeddings for `texts` and return (vectors, recommended_threshold).
    backends:
      - "sbert": SentenceTransformer all-MiniLM-L6-v2 (recommended)
      - "tfidf": sklearn TF-IDF (char 3–5) L2 normalized
      - "char":  pure-Python char n-grams (3–5), L2 normalized
    """
    if backend == "sbert":
        arr = _SBERT_MODEL.encode(texts, normalize_embeddings=True)
        vecs = _EmbeddingVectors(name="sentence_transformers/all-MiniLM-L6-v2")
        vecs.set_dense(arr)
        return vecs, 0.78  # tuned per request

    if backend == "tfidf":
        v = TfidfVectorizer(
            analyzer="char_wb",
            ngram_range=(3, 5),
            min_df=1,
            lowercase=True,
            norm=None,
            use_idf=True,
            smooth_idf=True,
            sublinear_tf=True,
        )
        X = v.fit_transform(texts)
        X = normalize(X, norm="l2", copy=False)
        vecs = _EmbeddingVectors(name="sklearn/tfidf-char")
        vecs.set_sparse(X)
        return vecs, 0.65

    # backend == "char"
    def _char_ngrams(s: str, lo: int = 3, hi: int = 5) -> List[str]:
        s = f" {s} "
        grams: List[str] = []
        for n in range(lo, hi + 1):
            if len(s) >= n:
                grams.extend(s[i:i+n] for i in range(len(s) - n + 1))
        return grams

    vec_list: List[Dict[str, float]] = []
    for t in texts:
        grams = _char_ngrams(t or "")
        c = Counter(grams)
        norm_sq = sum(w * w for w in c.values())
        if norm_sq <= 0:
            vec_list.append({})
        else:
            norm = norm_sq ** 0.5
            vec_list.append({k: w / norm for k, w in c.items()})
    vecs = _EmbeddingVectors(name="stdlib/char-ngrams")
    vecs._vectors = vec_list  # list[dict], treated as dense-like
    return vecs, 0.65


# ------------------------- Candidate pair stages -------------------------

def _candidate_pairs_by_length(norm_strs: List[str]) -> List[Tuple[int, int]]:
    """
    Candidate pairs by length proximity (±2), capped for safety.
    """
    length_buckets: Dict[int, List[int]] = defaultdict(list)
    for i, s in enumerate(norm_strs):
        length_buckets[len(s)].append(i)

    pairs: List[Tuple[int, int]] = []
    keys = sorted(length_buckets.keys())
    for k in keys:
        nearby: List[int] = []
        for kk in (k - 2, k - 1, k, k + 1, k + 2):
            nearby.extend(length_buckets.get(kk, []))
        # dedupe + cap
        seen_local: Set[int] = set()
        local: List[int] = []
        for idx in nearby:
            if idx not in seen_local:
                seen_local.add(idx)
                local.append(idx)
        m = len(local)
        if m * (m - 1) // 2 > MAX_PAIRS_PER_BUCKET:
            limit = int((2 * MAX_PAIRS_PER_BUCKET) ** 0.5)
            local = local[:max(2, limit)]
            m = len(local)
        for a in range(m):
            ia = local[a]
            for b in range(a + 1, m):
                ib = local[b]
                pairs.append((ia, ib))
    return pairs

def _candidate_pairs_by_tokens(token_lists: List[List[str]]) -> List[Tuple[int, int]]:
    """
    Candidate pairs from per-token buckets (content tokens), capped for safety.
    """
    inv: Dict[str, List[int]] = defaultdict(list)
    for i, toks in enumerate(token_lists):
        for t in set(toks):
            inv[t].append(i)

    pairs: List[Tuple[int, int]] = []
    for _, idxs in inv.items():
        n = len(idxs)
        if n < 2:
            continue
        if n * (n - 1) // 2 > MAX_PAIRS_PER_BUCKET:
            limit = int((2 * MAX_PAIRS_PER_BUCKET) ** 0.5)
            idxs = idxs[:max(2, limit)]
            n = len(idxs)
        for a in range(n):
            i = idxs[a]
            for b in range(a + 1, n):
                j = idxs[b]
                pairs.append((i, j))
    return pairs

def _head_token_from_tokens(toks: List[str]) -> str:
    """
    Dynamic headword heuristic: rightmost content token after normalization/singularization.
    Examples:
      - "consequence-based thresholds" -> "threshold"
      - "response thresholds" -> "threshold"
    """
    return toks[-1] if toks else ""

def _candidate_pairs_by_headwords(head_tokens: List[str]) -> List[Tuple[int, int]]:
    """
    Pairs items that share the same dynamic head token. No hardcoded lexicon.
    """
    buckets: Dict[str, List[int]] = defaultdict(list)
    for i, h in enumerate(head_tokens):
        if h:
            buckets[h].append(i)

    pairs: List[Tuple[int, int]] = []
    for _, idxs in buckets.items():
        n = len(idxs)
        if n < 2:
            continue
        if n * (n - 1) // 2 > MAX_PAIRS_PER_BUCKET:
            limit = int((2 * MAX_PAIRS_PER_BUCKET) ** 0.5)
            idxs = idxs[:max(2, limit)]
            n = len(idxs)
        for a in range(n):
            i = idxs[a]
            for b in range(a + 1, n):
                j = idxs[b]
                pairs.append((i, j))
    return pairs

def _candidate_pairs_by_knn(emb: _EmbeddingVectors, k: int) -> List[Tuple[int, int]]:
    """
    Embedding k-NN candidate pairs using sklearn NearestNeighbors (cosine).
    Returns undeduplicated pairs; caller dedupes.
    """
    v = emb._vectors
    pairs: Set[Tuple[int, int]] = set()

    # Dense
    if not emb._sparse and hasattr(v, "shape"):
        n = int(v.shape[0])
        if n <= 1:
            return []
        nn = NearestNeighbors(n_neighbors=min(k + 1, n), metric="cosine", algorithm="auto")
        nn.fit(v)
        dists, idxs = nn.kneighbors(v, return_distance=True)  # cosine distance
        for i in range(n):
            for pos in range(1, idxs.shape[1]):  # skip self at 0
                j = int(idxs[i, pos])
                if i == j:
                    continue
                a, b = (i, j) if i < j else (j, i)
                pairs.add((a, b))
        return list(pairs)

    # Sparse
    if emb._sparse and hasattr(v, "tocsr"):
        n = v.shape[0]
        if n <= 1:
            return []
        nn = NearestNeighbors(n_neighbors=min(k + 1, n), metric="cosine", algorithm="brute")
        nn.fit(v)
        dists, idxs = nn.kneighbors(v, return_distance=True)
        for i in range(n):
            for pos in range(1, idxs.shape[1]):  # skip self
                j = int(idxs[i, pos])
                if i == j:
                    continue
                a, b = (i, j) if i < j else (j, i)
                pairs.add((a, b))
        return list(pairs)

    # Pure-python dict vectors: skip (no efficient index here)
    return []


# ------------------------- Merge decision -------------------------

def _should_merge_pair(
    i: int,
    j: int,
    norm_strs: List[str],
    guard_sets: List[Set[str]],
    head_tokens: List[str],
    emb: _EmbeddingVectors,
    emb_threshold: float,
) -> bool:
    """
    Merge decision rule:
      - If guards present and disjoint -> do NOT merge.
      - If char similarity >= HARD_CHAR_THRESHOLD -> merge.
      - Else if embedding cosine >= emb_threshold (with small headword-based boost) -> merge.
      - Else if char similarity >= FUZZY_SIM_THRESHOLD -> merge.
    """
    # Guard gating (dynamic; if you have guards)
    if guard_sets[i] or guard_sets[j]:
        if guard_sets[i].isdisjoint(guard_sets[j]):
            return False

    si = norm_strs[i]
    sj = norm_strs[j]

    # Near-identical char match wins
    char_sim = _similar(si, sj)
    if char_sim >= HARD_CHAR_THRESHOLD:
        return True

    # Embedding similarity with adaptive headword bonus
    emb_sim = emb.similarity(i, j)
    same_head = head_tokens[i] and (head_tokens[i] == head_tokens[j])
    local_emb_thr = emb_threshold - HEADWORD_EMB_BONUS if same_head else emb_threshold
    local_emb_thr = max(local_emb_thr, EMB_SIM_FLOOR)

    if emb_sim >= local_emb_thr:
        return True

    # Char fallback
    return char_sim >= FUZZY_SIM_THRESHOLD


# ------------------------- Clustering (global-first) -------------------------

def _cluster_texts_with_embeddings(texts: List[str], emb_backend: str = "sbert") -> Dict[int, List[int]]:
    """
    Cluster a list of texts using:
      - candidate pairs (length ±2 + token buckets + headword buckets + k-NN)
      - guard-phrase gating (optional)
      - embeddings + fuzzy character similarity
    Returns: root_index -> [member_indices]
    """
    n = len(texts)
    if n == 0:
        return {}

    norm_strs = [_harmonize(s) for s in texts]
    token_lists = [_tokens_for(s) for s in texts]
    guard_sets = [_guard_set(s) for s in texts]
    head_tokens = [_head_token_from_tokens(toks) for toks in token_lists]

    # Build embeddings (vectors L2-normalized)
    emb, emb_thr = _build_embeddings(norm_strs, backend=emb_backend)

    # Candidate pairs (union of sources)
    pairs_set: Set[Tuple[int, int]] = set()

    # Length proximity
    for p in _candidate_pairs_by_length(norm_strs):
        a, b = (p if p[0] < p[1] else (p[1], p[0]))
        pairs_set.add((a, b))

    # Shared content tokens
    for p in _candidate_pairs_by_tokens(token_lists):
        a, b = (p if p[0] < p[1] else (p[1], p[0]))
        pairs_set.add((a, b))

    # Shared headword pairs (dynamic, no hardcoded nouns)
    for p in _candidate_pairs_by_headwords(head_tokens):
        a, b = (p if p[0] < p[1] else (p[1], p[0]))
        pairs_set.add((a, b))

    # Embedding k-NN pairs
    for p in _candidate_pairs_by_knn(emb, k=KNN_K):
        a, b = (p if p[0] < p[1] else (p[1], p[0]))
        pairs_set.add((a, b))

    dsu = _DSU(n)

    # Evaluate pairs with merge rule
    for i, j in pairs_set:
        if _should_merge_pair(i, j, norm_strs, guard_sets, head_tokens, emb, emb_thr):
            dsu.union(i, j)

    # Collect clusters
    clusters: Dict[int, List[int]] = defaultdict(list)
    for i in range(n):
        clusters[dsu.find(i)].append(i)
    return clusters


# ------------------------- Public: fuzzy+embedding merge for an inventory (global) -------------------------

def merge_inventory_fuzzy(inventory: List[Dict[str, Any]], emb_backend: str = "sbert") -> Dict[str, Any]:
    """
    Merge near-duplicate inventory items using fuzzy + embedding clustering **globally**.

    INPUT
    -----
    inventory: List[{"theme_id": str, "theme": str, "count": int}, ...]
    emb_backend: "sbert" (default) | "tfidf" | "char"

    OUTPUT
    ------
    {
      "inventory": merged_list_sorted,
      "mapping_old_to_new": { old_id: new_merged_id, ... },
      "clusters": [ { "theme_id": merged_id, "members": [old_ids...] }, ... ],
    }
    """
    if not inventory:
        return {"inventory": [], "mapping_old_to_new": {}, "clusters": []}

    orig_ids: List[str] = [str(x.get("theme_id", "")) for x in inventory]
    texts: List[str]   = [str(x.get("theme", ""))    for x in inventory]
    counts: List[int]  = [int(x.get("count", 0))     for x in inventory]

    # Cluster by theme strings (GLOBAL)
    buckets = _cluster_texts_with_embeddings(texts, emb_backend=emb_backend)

    mapping_old_to_new: Dict[str, str] = {}
    merged_list: List[Dict[str, Any]] = []
    cluster_records: List[Dict[str, Any]] = []

    for _, idxs in buckets.items():
        # Sum counts
        total_count = int(sum(counts[i] for i in idxs))
        # Display variant
        variants = Counter(texts[i] for i in idxs)
        display = _choose_display(variants) or texts[idxs[0]]
        # Stable merged id based on member original ids (stable across runs)
        merged_id = _stable_cluster_id([orig_ids[i] for i in idxs])

        merged_list.append({"theme_id": merged_id, "theme": display, "count": total_count})
        cluster_records.append({"theme_id": merged_id, "members": [orig_ids[i] for i in idxs]})
        for i in idxs:
            mapping_old_to_new[orig_ids[i]] = merged_id

    merged_list.sort(key=lambda x: (-x["count"], x["theme"]))
    return {"inventory": merged_list, "mapping_old_to_new": mapping_old_to_new, "clusters": cluster_records}


# ------------------------- NEW: build global LLM jobs from the (global) inventory -------------------------
def _pack_clusters_for_llm(
    clusters: List[List[Dict[str, Any]]],
    min_size: int = MIN_THEMES_PER_JOB,
    max_size: int = MAX_THEMES_PER_JOB,
) -> List[List[Dict[str, Any]]]:
    """
    Make LLM jobs with ≥ min_size and ≤ max_size items:
      - big clusters (len >= min_size) → one job each (order preserved)
      - small clusters                → flattened, globally sorted by count desc, and greedily packed
    Notes:
      • Items inside each cluster are expected to already be sorted by (-count, theme) upstream.
      • If the total 'small' pool is < min_size, we emit one small job (instead of forcing padding).
    """
    # Separate clusters
    big: List[List[Dict[str, Any]]] = []
    small: List[List[Dict[str, Any]]] = []
    for c in clusters:
        if len(c) >= min_size:
            big.append(c)     # keep upstream order
        else:
            small.append(c)

    # Start with big clusters as-is
    jobs: List[List[Dict[str, Any]]] = list(big)

    # Flatten + sort the small pool globally by count desc, then stable theme name
    if small:
        pool: List[Dict[str, Any]] = [it for c in small for it in c]
        pool.sort(key=lambda it: (-int(it.get("count", 0)), str(it.get("theme", ""))))

        n = len(pool)
        i = 0
        if n < min_size:
            # Not enough to reach min_size → emit a single (small) job
            jobs.append(pool)
        else:
            # Greedily pack [min_size..max_size]
            while i < n:
                remaining = n - i
                take = min(max_size, remaining)
                # Try to respect min_size unless this is the final small remainder
                if take < min_size and i == 0:
                    # Shouldn't happen because n >= min_size, but keep a guard
                    take = remaining
                jobs.append(pool[i:i + take])
                i += take

    return jobs


def build_global_jobs_from_inventory(inventory: List[Dict[str, Any]],
                                     emb_backend: str = "sbert",
                                     min_size: int = MIN_THEMES_PER_JOB,
                                     max_size: int = MAX_THEMES_PER_JOB) -> List[List[Dict[str, Any]]]:
    """
    GLOBAL-FIRST workflow helper:
      1) Cluster across the **entire** inventory (not per batch).
      2) Sort each cluster (by count desc, then theme asc).
      3) Pack clusters into LLM jobs (min…max items per job).
    Returns:
      List of jobs; each job is a list of {"theme_id","theme","count"} dicts.
    """
    if not inventory:
        return []

    # Step 1: cluster globally
    texts = [str(x.get("theme", "")) for x in inventory]
    buckets = _cluster_texts_with_embeddings(texts, emb_backend=emb_backend)

    # Step 2: build cluster lists and sort within cluster
    clusters: List[List[Dict[str, Any]]] = []
    for _, idxs in sorted(buckets.items(), key=lambda kv: min(kv[1]) if kv[1] else 10**9):
        cluster = [inventory[i] for i in idxs]
        cluster.sort(key=lambda it: (-int(it.get("count", 0)), str(it.get("theme", ""))))
        clusters.append(cluster)

    clusters = clusters or [inventory]  # safety

    # Step 3: pack clusters to jobs
    jobs = _pack_clusters_for_llm(clusters, min_size=min_size, max_size=max_size)
    return jobs
# =========================  end replacement  =========================


def sort_inventory_in_place_by_count_then_theme(inventory: List[Dict[str, Any]]) -> None:
    """
    Sorts the list in-place by: high count first, then theme string A–Z for stability.
    """
    inventory.sort(key=lambda it: (-_item_count(it), str(it.get("theme", ""))))

def extract_themes_and_hierarchy(
        collection_name: str,
        dir_path: str,
        results_by_item: Dict[str, Dict[str, Any]],
        batch_size: int = 50,
        *,
        section_title: Optional[str] = None,
        research_questions: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Scans `results_by_item` to collect unique potential themes (document frequency),
    clusters near-duplicates, assigns stable IDs, builds batches, and calls
    `process_themes_batches(...)`. Always returns a dict with a stable shape.
    """

    # ------------------------- 1) Scan & aggregate (document frequency) -------------------------


    df_items: Dict[str, Set[str]] = defaultdict(set)          # canon_term -> set(item_keys)
    variants: Dict[str, Counter] = defaultdict(Counter)        # canon_term -> Counter({raw_variant: count})

    for item_key, bundle in (results_by_item or {}).items():
        ev_list = _ensure_list((bundle or {}).get("evidence_list"))
        if not ev_list:
            continue

        per_item_themes: Set[str] = set()  # DF per item (not per evidence)

        for e in ev_list:
            pts = _ensure_list((e or {}).get("potential_themes"))
            if not pts:
                continue
            for raw in pts:
                raw_str = str(raw or "").strip()
                canon = _canon_theme(raw_str)
                if not canon:
                    continue
                per_item_themes.add(canon)
                if raw_str:
                    variants[canon][raw_str] += 1

        for canon in per_item_themes:
            df_items[canon].add(item_key)

    # Short-circuit if nothing found
    if not df_items:
        return {
            "ok": True,
            "seed_custom_id": "",
            "classify_custom_ids": [],
            "section_title": collection_name or "Global",
            "gold_file_path": "",
            "seed_outline": {},
            "overarching_themes": [],
            "assignments": {},
            "leftovers": [],
            "classify_outputs_raw": [],
            "analysis_key_suffix": "themes_hierarchy_v1",
            "n_batches": 0,
            "inventory_index": {},
        }

    # ------------------------- 2) Fuzzy + embedding clustering -------------------------
    canon_terms: List[str] = list(df_items.keys())
    buckets = _cluster_texts_with_embeddings(canon_terms)

    # ------------------------- 3) Build merged inventory & stable IDs -------------------------
    inventory: List[Dict[str, Any]] = []

    # hydration indexes
    inventory_index: Dict[str, Dict[str, Any]] = {}  # theme_id -> {"theme": display, "count": int}
    id_to_canon_members: Dict[str, List[str]] = {}  # theme_id -> list[canon]
    id_to_items: Dict[str, List[str]] = {}  # theme_id -> list[item_keys]
    canon_to_id: Dict[str, str] = {}  # canon -> theme_id

    # NEW: theme_id -> [ {item_key, metadata, evidence_list}, ... ]
    inventory_mapping: Dict[str, List[Dict[str, Any]]] = {}

    for _, idxs in buckets.items():
        items_union: Set[str] = set()
        merged_variants: Counter = Counter()
        canon_members: List[str] = []

        for i in idxs:
            canon = canon_terms[i]
            canon_members.append(canon)
            items_union.update(df_items[canon])
            merged_variants.update(variants.get(canon, Counter()))

        display = _choose_display(merged_variants) or canon_terms[idxs[0]]
        theme_id = _stable_cluster_id(canon_members)

        inventory.append({
            "theme_id": theme_id,
            "theme": display,
            "count": int(len(items_union)),
        })

        inventory_index[theme_id] = {"theme": display, "count": int(len(items_union))}
        id_to_canon_members[theme_id] = sorted(set(canon_members))
        id_to_items[theme_id] = sorted(set(items_union))
        for c in canon_members:
            canon_to_id[c] = theme_id

        # NEW: build full payload mapping for this theme_id now (so hydration won't need results_by_item later)
        items_full: List[Dict[str, Any]] = []
        for k in sorted(items_union):
            b = (results_by_item or {}).get(k) or {}
            if isinstance(b, dict) and b:
                items_full.append({
                    "item_key": k,
                    "metadata": b.get("metadata", {}),
                    "evidence_list": b.get("evidence_list", []),
                })
            else:
                items_full.append({"item_key": k})
        inventory_mapping[theme_id] = items_full

    # ------------------------- 4) Create batches -------------------------
    sort_inventory_in_place_by_count_then_theme(inventory)
    batches: List[List[Dict[str, Any]]] = _chunk(inventory, batch_size)

    # ------------------------- 5) Call the batch processor -------------------------
    # Pass an explicit section_title so downstream files have a readable label.
    processed = process_themes_batches(
        base_dir=dir_path,
        batches=batches,
        inventory_index=inventory_index,
        hydrate={
            "id_to_items": id_to_items,
            "id_to_canon_members": id_to_canon_members,
        },
        results_by_item=results_by_item,
        inventory_mapping=inventory_mapping,
        collection_name=collection_name,  # short, stable folder segment
        section_title=section_title or collection_name,  # human label (RQ)
        research_questions=research_questions or section_title or collection_name,
    )



    # ------------------------- 6) Normalize and append inventory_index -------------------------
    out = processed if isinstance(processed, dict) else {}

    # Bubble up hydrated pointers for the per-RQ wrapper/manifest
    paths_from_proc = out.get("paths") or {}
    for k in ("themes_only", "hydrated_only", "gold_file_path"):
        v = paths_from_proc.get(k)
        if isinstance(v, str) and v.strip():
            out["export_paths"] = {**out.get("export_paths", {}), k: v}

    # ensure a stable shape even on errors
    defaults = {
        "ok": False,
        "seed_custom_id": "",
        "classify_custom_ids": [],
        "section_title": collection_name or "Global",
        "gold_file_path": "",
        "seed_outline": {},
        "overarching_themes": [],   # usually [{theme_id, title}, ...] from process_themes_batches
        "assignments": {},          # gold_id -> [inventory theme_ids...]
        "leftovers": [],
        "classify_outputs_raw": [],
        "analysis_key_suffix": "themes_hierarchy_v1",
        "n_batches": len(batches),
    }
    for k, v in defaults.items():
        out.setdefault(k, v)

    # attach hydration map for downstream use
    # attach hydration map for downstream use
    out["inventory_index"] = inventory_index

    # ------------------------- 6b) Persist JSONs to thematic_outputs/<collection_name> -------------------------
    try:
        def _slug_name(s: str) -> str:
            return re.sub(r"[^A-Za-z0-9._-]+", "_", (s or "themes")).strip("_")

            # -------------------- ensure export folder --------------------

        dir_base = dir_path
        out_dir = dir_base
        os.makedirs(out_dir, exist_ok=True)
        stem = _slug_name(collection_name)

        export_paths = {}

        # (a) results_by_item
        rbi_path = os.path.join(out_dir, f"{stem}_results_by_item.json")
        with open(rbi_path, "w", encoding="utf-8") as f:
            json.dump(results_by_item or {}, f, ensure_ascii=False, indent=2)
        export_paths["results_by_item_path"] = rbi_path

        # (b) inventory_index
        inv_idx_path = os.path.join(out_dir, f"{stem}_inventory_index.json")
        with open(inv_idx_path, "w", encoding="utf-8") as f:
            json.dump(inventory_index or {}, f, ensure_ascii=False, indent=2)
        export_paths["inventory_index_path"] = inv_idx_path

        # (c) inventory_mapping (theme_id -> full items)
        inv_map_path = os.path.join(out_dir, f"{stem}_inventory_mapping.json")
        with open(inv_map_path, "w", encoding="utf-8") as f:
            json.dump(inventory_mapping or {}, f, ensure_ascii=False, indent=2)
        export_paths["inventory_mapping_path"] = inv_map_path

        # Attach paths to return object
        out["export_paths"] = {**out.get("export_paths", {}), **export_paths}
    except Exception as _e:
        out.setdefault("_export_error", str(_e))



    return out

def _slug_name(s: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "_", str(s or "untitled")).strip("_")[:120]

# ---------- helpers: sanitize + normalize ----------

# def _ensure_list(x):
#     if x is None:
#         return []
#     if isinstance(x, list):
#         return x
#     return [x]

def _norm_label(s: str) -> str:
    # Compact whitespace + trim
    return " ".join((s or "").split())

def _try_parse_indexed_line(line: str):
    # e.g., "0: What is ..." → (0, "What is ...")
    if not isinstance(line, str):
        return None, None
    m = re.match(r"^\s*(\d+)\s*:\s*(.+)$", line.strip())
    if not m:
        return None, None
    return int(m.group(1)), _norm_label(m.group(2))

def _collect_idx_to_label_from_metadata_rq_lines(md: Dict[str, Any]) -> Dict[int, str]:
    idx_to_label = {}
    for line in _ensure_list((md or {}).get("rq_lines")):
        idx, label = _try_parse_indexed_line(line or "")
        if idx is not None and label:
            idx_to_label.setdefault(idx, label)
    return idx_to_label

def _merge_idx_label(global_idx_to_label: Dict[int, str], local: Dict[int, str]):
    # First writer wins; if conflict, keep the original (avoids oscillation).
    for i, lab in (local or {}).items():
        if i not in global_idx_to_label and lab:
            global_idx_to_label[i] = lab

def _indices_for_ev(ev: Dict[str, Any]) -> List[int]:
    out = []
    for rq in _ensure_list(ev.get("relevant_rqs")):
        if isinstance(rq, dict):
            if isinstance(rq.get("index"), int):
                out.append(rq["index"])
            elif isinstance(rq.get("index"), str) and rq["index"].isdigit():
                out.append(int(rq["index"]))
    return out

def _labels_for_ev(ev: Dict[str, Any]) -> List[str]:
    out = []
    for rq in _ensure_list(ev.get("relevant_rqs")):
        q = rq.get("question")
        if isinstance(q, str) and q.strip():
            out.append(_norm_label(q))
    return out

# # ----- small helpers -----
# def _ensure_list(x):
#     if x is None: return []
#     return x if isinstance(x, list) else [x]
#
# def _collect_idx_to_label_from_metadata_rq_lines(md: Dict[str, Any]) -> Dict[int, str]:
#     """
#     Parse metadata.rq_lines entries like '0: question text'.
#     """
#     out: Dict[int, str] = {}
#     for line in _ensure_list(md.get("rq_lines")):
#         if not isinstance(line, str):
#             continue
#         m = re.match(r"\s*(\d+)\s*:\s*(.+)$", line.strip())
#         if m:
#             idx = int(m.group(1))
#             lab = m.group(2).strip()
#             if lab:
#                 out.setdefault(idx, lab)
#     return out
#
# def _merge_idx_label(dst: Dict[int, str], src: Dict[int, str]) -> None:
#     """
#     First writer wins: only set label if idx is not present yet.
#     """
#     for k, v in (src or {}).items():
#         if k not in dst and isinstance(v, str) and v.strip():
#             dst[k] = v.strip()
#
# def _indices_for_ev(ev: Dict[str, Any]) -> List[int]:
#     idxs: List[int] = []
#     for r in _ensure_list(ev.get("relevant_rqs")):
#         if isinstance(r, dict) and isinstance(r.get("index"), int):
#             idxs.append(int(r["index"]))
#     return idxs
#
# def _labels_for_ev(ev: Dict[str, Any]) -> List[str]:
#     labs: List[str] = []
#     for r in _ensure_list(ev.get("relevant_rqs")):
#         if isinstance(r, dict):
#             q = (r.get("question") or "").strip()
#             if q:
#                 labs.append(q)
#         elif isinstance(r, str) and r.strip():
#             labs.append(r.strip())
#     return labs
# # ----- end helpers -----


def partition_results_by_rq_index(
    results_by_item: Dict[str, Dict[str, Any]]
) -> Tuple[Dict[int, Dict[str, Dict[str, Any]]], Dict[int, str]]:
    """
    Returns:
      per_idx: { rq_index -> sliced_results_by_item }, where each item's evidence_list
               contains ONLY the evidence rows that reference that rq_index.
      idx_to_label: { rq_index -> human label }, aggregated from metadata.rq_lines
                    and relevant_rqs[].question (best effort).
    """
    per_idx: Dict[int, Dict[str, Dict[str, Any]]] = {}
    idx_to_label: Dict[int, str] = {}

    # 1) learn labels from metadata.rq_lines (if present)
    for _, bundle in (results_by_item or {}).items():
        md = (bundle or {}).get("metadata") or {}
        _merge_idx_label(idx_to_label, _collect_idx_to_label_from_metadata_rq_lines(md))

    # 2) also learn labels from evidence.relevant_rqs[].question (first writer wins)
    for _, bundle in (results_by_item or {}).items():
        for ev in _ensure_list((bundle or {}).get("evidence_list")):
            ev_indices = _indices_for_ev(ev)
            ev_labels  = _labels_for_ev(ev)
            if not ev_indices:
                continue
            if ev_labels:
                lab = next((l for l in ev_labels if l), None)
                if lab:
                    for idx in ev_indices:
                        if idx not in idx_to_label:
                            idx_to_label[idx] = lab

    # 3) build per-index slices with evidence filtered to that index
    for item_key, bundle in (results_by_item or {}).items():
        md = dict((bundle or {}).get("metadata") or {})
        ev_list = _ensure_list((bundle or {}).get("evidence_list"))

        # Map: idx -> list of evidence for that idx
        ev_by_idx: Dict[int, List[Dict[str, Any]]] = {}
        for ev in ev_list:
            idxs = _indices_for_ev(ev)
            if not idxs:
                continue
            for idx in idxs:
                ev_by_idx.setdefault(idx, []).append(ev)

        # Emit a filtered copy into each rq-index slice
        for idx, filtered_evs in ev_by_idx.items():
            md_copy = dict(md)
            md_copy["rq_index"] = idx
            if idx in idx_to_label:
                md_copy["rq_label"] = idx_to_label[idx]

            per_idx.setdefault(idx, {})
            if item_key not in per_idx[idx]:
                per_idx[idx][item_key] = {
                    "metadata": md_copy,
                    "evidence_list": list(filtered_evs),
                }
            else:
                per_idx[idx][item_key]["evidence_list"].extend(filtered_evs)

    # 4) dedup evidence rows within each (rq_idx, item_key)
    for _, items in per_idx.items():
        for _, b in (items or {}).items():
            seen: Set[Tuple] = set()
            deduped = []
            for ev in _ensure_list(b.get("evidence_list")):
                sig = (
                    ev.get("direct_quote"),
                    ev.get("paraphrase"),
                    ev.get("evidence_type"),
                    tuple(sorted(_ensure_list(ev.get("potential_themes")))),
                )
                if sig in seen:
                    continue
                seen.add(sig)
                deduped.append(ev)
            b["evidence_list"] = deduped

    return per_idx, idx_to_label

def _norm_rq(s: str) -> str:
    # normalize spacing, quotes; keep content
    if not isinstance(s, str):
        return ""
    s = re.sub(r"\s+", " ", s.replace("“", '"').replace("”", '"').replace("’", "'")).strip()
    return s

def partition_results_by_rq(results_by_item: Dict[str, Dict[str, Any]]
) -> Dict[str, Dict[str, Dict[str, Any]]]:
    """
    Returns: { rq_label -> sliced_results_by_item }
    If a label is unknown for an index, falls back to f"RQ {idx}".
    """
    per_idx, idx_to_label = partition_results_by_rq_index(results_by_item)
    per_label: Dict[str, Dict[str, Dict[str, Any]]] = {}

    for idx, subset in (per_idx or {}).items():
        label = idx_to_label.get(idx) or f"RQ {idx}"
        per_label[label] = subset
    return per_label

# ---------- orchestrator: run your pipeline once per RQ slice ----------
def extract_themes_and_hierarchy_by_rq(
    collection_name: str,
    dir_path: str,
    results_by_item: Dict[str, Dict[str, Any]],
    batch_size: int = 50,
    *,
    cache: bool = True,   # <-- NEW: default True
) -> Dict[str, Any]:
    """
    Split results_by_item by research question index, and run extract_themes_and_hierarchy
    per RQ so every question gets its own set of files.

    If cache=True and an existing manifest.json is found under:
        {dir_path}/{slug(collection_name)}/manifest.json
    this returns that manifest (after a quick on-disk path sanity check)
    without recomputing per-RQ outputs.
    """

    if not isinstance(dir_path, str) or not dir_path.strip():
        raise ValueError("dir_path must be a non-empty string")

    os.makedirs(dir_path, exist_ok=True)

    def _slug_name(s: str) -> str:
        return re.sub(r"[^A-Za-z0-9._-]+", "_", (s or "themes")).strip("_")

    # Build per-RQ slices (by index) + labels
    per_idx, idx_to_label = partition_results_by_rq_index(results_by_item)

    base_coll_dir = os.path.join(dir_path, _slug_name(collection_name))
    os.makedirs(base_coll_dir, exist_ok=True)

    # -------------------- CACHE SHORT-CIRCUIT --------------------
    manifest_path = os.path.join(base_coll_dir, "manifest.json")
    if cache and os.path.isfile(manifest_path):
        # load manifest and ensure it points to at least one existing file
        with open(manifest_path, "r", encoding="utf-8") as f:
            manifest_loaded = json.load(f) or {}
        outputs = manifest_loaded.get("outputs") or []
        any_real_file = False
        for out in outputs:
            paths = out.get("paths") or {}
            for v in paths.values():
                if isinstance(v, str) and v.strip() and os.path.isfile(v):
                    any_real_file = True
                    break
            if any_real_file:
                break
        if any_real_file:
            return {
                "ok": True,
                "collection_name": collection_name,
                "per_rq": {},  # not reloaded here (use manifest paths downstream)
                "manifest": {**manifest_loaded, "path": manifest_path},
                "cached": True,
            }
    # -------------------------------------------------------------

    def _rq_dir_for_label(label: str) -> str:
        # Keep paths short, stable, and safe
        h = hashlib.md5((label or "").encode("utf-8")).hexdigest()[:10]
        return os.path.join(base_coll_dir, f"{_slug_name(label)[:40]}_{h}")

    def _worker(idx_and_subset):
        rq_idx, subset = idx_and_subset
        rq_label = idx_to_label.get(rq_idx, f"rq:{rq_idx}")

        # Ensure per-RQ directory exists
        rq_dir = _rq_dir_for_label(rq_label)
        os.makedirs(rq_dir, exist_ok=True)

        # Always write the per-RQ slice for traceability (even if empty)
        rbi_per_rq_path = os.path.join(rq_dir, "results_by_item_per_rq.json")
        with open(rbi_per_rq_path, "w", encoding="utf-8") as _f:
            json.dump(subset or {}, _f, ensure_ascii=False, indent=2)

        # If subset is empty, still create the usual filenames (empty structures)
        if not subset:
            stem = re.sub(r"[^A-Za-z0-9._-]+", "_", (collection_name or "themes")).strip("_")[:120]
            export_paths = {}

            p_results = os.path.join(rq_dir, f"{stem}_results_by_item.json")
            with open(p_results, "w", encoding="utf-8") as f:
                json.dump({}, f, ensure_ascii=False, indent=2)
            export_paths["results_by_item_path"] = p_results

            p_inv_idx = os.path.join(rq_dir, f"{stem}_inventory_index.json")
            with open(p_inv_idx, "w", encoding="utf-8") as f:
                json.dump({}, f, ensure_ascii=False, indent=2)
            export_paths["inventory_index_path"] = p_inv_idx

            p_inv_map = os.path.join(rq_dir, f"{stem}_inventory_mapping.json")
            with open(p_inv_map, "w", encoding="utf-8") as f:
                json.dump({}, f, ensure_ascii=False, indent=2)
            export_paths["inventory_mapping_path"] = p_inv_map

            out = {
                "ok": True,
                "inventory_index": {},
                "n_batches": 0,
                "export_paths": export_paths,
                "outputs_dir": rq_dir,
                "paths": {"results_by_item": rbi_per_rq_path},
            }
            return rq_label, out

        # Non-empty subset → run the extractor
        out = extract_themes_and_hierarchy(
            collection_name=collection_name,
            dir_path=rq_dir,
            results_by_item=subset,
            batch_size=batch_size,
            section_title=rq_label,
            research_questions=rq_label,
        )
        # record the per-RQ RBI path for convenience
        if isinstance(out, dict):
            if "paths" in out and isinstance(out["paths"], dict):
                out["paths"]["results_by_item"] = rbi_per_rq_path
            else:
                out["paths"] = {"results_by_item": rbi_per_rq_path}
        return rq_label, out

    all_outputs: Dict[str, Any] = {}
    manifest = {"collection_name": collection_name, "outputs": []}

    rq_items = list(per_idx.items())
    if not rq_items:
        manifest["path"] = manifest_path
        with open(manifest_path, "w", encoding="utf-8") as f:
            json.dump(manifest, f, ensure_ascii=False, indent=2)
        return {"ok": True, "collection_name": collection_name, "per_rq": {}, "manifest": manifest, "cached": False}

    # --- minimal progress helper (no third-party import, no try/except) ---
    class _Progress:
        def __init__(self, total: int, desc: str):
            self.total = int(total)
            self.n = 0
            self.desc = desc
        def update(self, k: int = 1):
            self.n += k
            # compact progress print; avoid flooding by keeping it simple
            print(f"[{self.desc}] {self.n}/{self.total}")
        def set_postfix(self, **kw):
            if kw:
                # mirror your earlier style briefly
                print(f"[{self.desc}] {kw}")
        def close(self):
            pass

    max_workers = min(8, len(rq_items))
    pbar = _Progress(total=len(rq_items), desc="Processing research questions")

    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as exe:
        futures = {exe.submit(_worker, pair): pair[0] for pair in rq_items}
        for fut in concurrent.futures.as_completed(futures):
            rq_idx = futures[fut]
            label = idx_to_label.get(rq_idx, f"rq:{rq_idx}")

            rq_done_label, out = fut.result()  # no try/except per your requirement
            all_outputs[rq_done_label] = out

            # Collect safe paths into the manifest
            paths = {}
            if isinstance(out, dict):
                v1 = out.get("hydrated_only_path")
                v2 = out.get("meta_path")
                v3 = out.get("classify_jsonl_path")
                v4 = out.get("outputs_dir")
                v5 = out.get("gold_file_path")
                if isinstance(v1, str) and v1.strip(): paths["hydrated_only_path"] = v1
                if isinstance(v2, str) and v2.strip(): paths["meta_path"] = v2
                if isinstance(v3, str) and v3.strip(): paths["classify_jsonl_path"] = v3
                if isinstance(v4, str) and v4.strip(): paths["outputs_dir"] = v4
                if isinstance(v5, str) and v5.strip(): paths["gold_file_path"] = v5
                exp = out.get("export_paths")
                if isinstance(exp, dict):
                    for k, v in exp.items():
                        if isinstance(v, str) and v.strip():
                            paths[k] = v
                pths = out.get("paths")
                if isinstance(pths, dict):
                    for k, v in pths.items():
                        if isinstance(v, str) and v.strip():
                            paths[k] = v

            inv_idx = out.get("inventory_index", {}) if isinstance(out, dict) else {}
            n_batches = out.get("n_batches", 0) if isinstance(out, dict) else 0

            manifest["outputs"].append({
                "rq": label,
                "rq_index": rq_idx,
                "slug": _slug_name(label),
                "counts": {
                    "themes": len(inv_idx) if isinstance(inv_idx, dict) else 0,
                    "batches": n_batches,
                },
                "paths": paths,
            })

            pbar.set_postfix(rq=label[:40])
            pbar.update(1)

    pbar.close()

    # Write/refresh the manifest (acts as the cache file)
    manifest["path"] = manifest_path
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    return {
        "ok": True,
        "collection_name": collection_name,
        "per_rq": all_outputs,
        "manifest": manifest,
        "cached": False,
    }




from collections import  Counter

# tune as desired
MIN_THEMES_PER_JOB = 20
MAX_THEMES_PER_JOB = 80


# ---------- raw text getters (stage-specific) ----------

def _get_raw_text_seed(resp: Any) -> str:
    """
    Stage A (themes_hierarchy_v1).
    Try to pull out the most "message-like" text; often a single JSON object.
    """
    import json
    if isinstance(resp, dict):
        # direct dict? dump it
        if any(k in resp for k in ("headings", "leftovers", "outline_meta", "audit")):
            return json.dumps(resp, ensure_ascii=False)

        # common wrappers
        for k in ("result", "response", "payload", "output"):
            v = resp.get(k)
            if isinstance(v, dict) and any(x in v for x in ("headings", "leftovers", "outline_meta", "audit")):
                return json.dumps(v, ensure_ascii=False)

    # Responses/Chat style
    obj = _coerce_obj_to_dict(resp)
    if obj:
        # OpenAI "output" parts
        out = obj.get("output")
        if isinstance(out, list):
            parts = []
            for msg in out:
                if isinstance(msg, dict) and isinstance(msg.get("content"), list):
                    for c in msg["content"]:
                        if isinstance(c, dict):
                            t = c.get("text")
                            if isinstance(t, str) and t.strip():
                                parts.append(t)
            if parts:
                return "\n".join(parts).strip()

        # Chat-completions
        ch = obj.get("choices")
        if isinstance(ch, list) and ch:
            m = ch[0].get("message", {}) if isinstance(ch[0], dict) else {}
            t = m.get("content")
            if isinstance(t, str) and t.strip():
                return t

        # generic fields
        for k in ("raw_text", "text", "output_text", "response_text", "payload", "output"):
            v = obj.get(k)
            if isinstance(v, str) and v.strip():
                return v

    # last resort
    return str(resp) if resp is not None else ""

# ---------- generic utilities ----------

def _coerce_obj_to_dict(obj: Any) -> dict:
    if isinstance(obj, dict):
        return obj
    if hasattr(obj, "model_dump"):
        try: return obj.model_dump()
        except Exception: pass
    if hasattr(obj, "to_dict"):
        try: return obj.to_dict()
        except Exception: pass
    return {}

def _strip_code_fences(s: str) -> str:
    s = s.strip()
    if s.startswith("```"):
        s = s.lstrip("`")
        nl = s.find("\n")
        s = s[nl + 1:] if nl >= 0 else s
        if s.endswith("```"):
            s = s[:-3].strip()
    return s

def _maybe_tuple_unwrap(s: str) -> str:
    """
    Handle cases like: ('{"json":...}', 0.0)
    """
    import ast
    t = s.strip()
    if (t.startswith("(") and t.endswith(")")) or (t.startswith("[") and t.endswith("]")):
        try:
            lit = ast.literal_eval(t)
            if isinstance(lit, (list, tuple)) and lit:
                first = lit[0]
                if isinstance(first, str):
                    return first.strip()
                if isinstance(first, dict):
                    return json.dumps(first, ensure_ascii=False)
        except Exception:
            pass
    return s

def _json_candidates_from_string(s: str) -> list[str]:
    """
    Return all balanced {...} snippets from the string.
    """
    s = s.strip()
    out = []
    depth = 0; start = -1
    for i, ch in enumerate(s):
        if ch == "{":
            if depth == 0: start = i
            depth += 1
        elif ch == "}":
            if depth > 0:
                depth -= 1
                if depth == 0 and start >= 0:
                    out.append(s[start:i+1])
    return out

def _try_parse_json(s: str) -> dict | None:

    try:
        obj = json.loads(s)
        if isinstance(obj, dict):
            return obj
        if isinstance(obj, str):
            # double-encoded JSON
            obj2 = json.loads(obj)
            if isinstance(obj2, dict):
                return obj2
    except Exception:
        return None
    return None

def _pick_best_candidate(cands: list[dict], prefer_keys: tuple[str, ...]) -> dict | None:
    if not cands:
        return None
    def score(d: dict) -> float:
        # weight presence of preferred keys; small bonus for size
        hit = sum(2 for k in prefer_keys if k in d)
        return float(hit) + (len(d) * 1e-6)
    best = max(cands, key=score)
    return best

def _get_raw_text_classify(resp: Any) -> str:
    """
    Stage B (themes_assign_to_gold_v1).
    Same as seed, but we see more JSONL replays and tuple-wrapped strings.
    """
    s = _get_raw_text_seed(resp)  # start with the same heuristic
    if not isinstance(s, str):
        s = str(s)
    s = _strip_code_fences(s)
    s = _maybe_tuple_unwrap(s)  # ← important for ('{"..."}', 0.0)
    return s

# ---------- put these imports at the top of your file ----------

# ---------------------------------------------------------------

def _hydrate_theme_from_sources(theme_id: str,
                                inventory_index: dict,
                                hydrate: dict,
                                results_by_item: dict) -> dict:
    """Pure read-only hydrator used by the checker."""
    tid = str(theme_id or "")
    inv = inventory_index.get(tid, {})
    id2items = hydrate.get("id_to_items") or {}
    id2canon = hydrate.get("id_to_canon_members") or {}

    canon_members = id2canon.get(tid, []) or []
    item_keys = id2items.get(tid, []) or []
    if not item_keys and canon_members:
        # Treat canon members as item keys if no explicit items were stored
        item_keys = list(canon_members)

    items_full = []
    for k in item_keys:
        b = results_by_item.get(k, {})
        if isinstance(b, dict) and b:
            items_full.append({
                "item_key": k,
                "metadata": b.get("metadata", {}),
                "evidence_list": b.get("evidence_list", []),
            })
        else:
            items_full.append({
                "item_key": k,
                "_missing_in_results_by_item": True,
            })

    return {
        "theme_id": tid,
        "theme": inv.get("theme"),
        "count": inv.get("count"),
        "canon_members": canon_members,
        "items": items_full,
    }


def debug_check_hydration(gold_file_path: str,
                          jobs: list | None = None,
                          sample_per_bucket: int = 3,
                          verbose: bool = True) -> dict:
    """
    Validates that Stage B hydration can traverse:
      gold.assignments[g] -> th_... ids -> hydrate maps -> results_by_item records.

    Returns a report dict with 'ok', 'problems', 'stats', and 'samples'.
    No try/except is used; make sure gold_file_path exists and is valid JSON.
    """
    report = {"ok": False, "problems": [], "stats": {}, "samples": {}}

    if not isinstance(gold_file_path, str) or not gold_file_path.strip():
        report["problems"].append("gold_file_path is empty")
        return report
    if not os.path.exists(gold_file_path):
        report["problems"].append(f"Gold file not found: {gold_file_path}")
        return report

    with open(gold_file_path, "r", encoding="utf-8") as f:
        gold = json.load(f)

    # Pull core structures
    hydration_sources = gold.get("hydration_sources") or {}
    inventory_index = hydration_sources.get("inventory_index") or {}
    hydrate = hydration_sources.get("hydrate") or {}
    results_by_item = hydration_sources.get("results_by_item") or {}

    # Shape checks + scaffolding
    if not hydration_sources:
        report["problems"].append("gold.hydration_sources is missing or empty")

    if "id_to_items" not in hydrate:
        report["problems"].append("hydrate.id_to_items is missing")
        hydrate["id_to_items"] = {}
    if "id_to_canon_members" not in hydrate:
        report["problems"].append("hydrate.id_to_canon_members is missing")
        hydrate["id_to_canon_members"] = {}

    assignments = gold.get("assignments") or {}
    if not assignments:
        report["problems"].append("gold.assignments is missing or empty")

    gold_ids = gold.get("overarching_theme_ids") or []
    if not gold_ids:
        report["problems"].append("gold.overarching_theme_ids is missing or empty")

    # Fallback inventory from jobs (read-only) if inventory_index is empty but jobs are provided
    if (not inventory_index) and isinstance(jobs, list):
        inv_tmp = {}
        for batch in jobs:
            for it in (batch or []):
                if isinstance(it, dict):
                    tid = str(it.get("theme_id") or "")
                    if tid:
                        if tid not in inv_tmp:
                            inv_tmp[tid] = {"theme": it.get("theme"), "count": 0}
                        c = it.get("count", 0)
                        if isinstance(c, int):
                            if c > inv_tmp[tid]["count"]:
                                inv_tmp[tid]["count"] = c
        inventory_index = inv_tmp
        if not inventory_index:
            report["problems"].append("inventory_index empty and could not be derived from jobs")

    # Aggregate stats & integrity checks
    all_theme_ids = set()
    total_assigned_ids = 0
    for gid in gold_ids:
        tids = assignments.get(gid) or []
        total_assigned_ids += len(tids)
        for t in tids:
            all_theme_ids.add(str(t))

    # Missing theme_ids in inventory_index
    missing_in_inventory = sorted([t for t in all_theme_ids if t not in inventory_index])

    # Missing item_keys in results_by_item
    id2items = hydrate.get("id_to_items") or {}
    id2canon = hydrate.get("id_to_canon_members") or {}
    missing_items_in_rbi = []
    for t in all_theme_ids:
        item_keys = id2items.get(t, []) or id2canon.get(t, []) or []
        for k in item_keys:
            if k not in results_by_item:
                missing_items_in_rbi.append(k)
    missing_items_in_rbi = sorted(set(missing_items_in_rbi))

    # Build samples per gold bucket
    samples = {}
    for gid in gold_ids:
        tids = assignments.get(gid) or []
        head = tids[:sample_per_bucket]
        hydrated = [_hydrate_theme_from_sources(t, inventory_index, hydrate, results_by_item) for t in head]
        samples[gid] = hydrated

    # Stats
    report["stats"] = {
        "num_gold_buckets": len(gold_ids),
        "total_assigned_theme_ids": total_assigned_ids,
        "unique_assigned_theme_ids": len(all_theme_ids),
        "inventory_index_size": len(inventory_index),
        "results_by_item_size": len(results_by_item),
        "hydrate_id_to_items_size": sum(len(v) for v in (id2items).values()),
        "hydrate_id_to_canon_members_size": sum(len(v) for v in (id2canon).values()),
        "missing_theme_ids_in_inventory_index": len(missing_in_inventory),
        "missing_items_in_results_by_item": len(missing_items_in_rbi),
    }

    # Problem list
    if missing_in_inventory:
        report["problems"].append(
            f"{len(missing_in_inventory)} assigned theme_ids are missing in inventory_index "
            f"(e.g., {missing_in_inventory[:5]})"
        )
    if missing_items_in_rbi:
        report["problems"].append(
            f"{len(missing_items_in_rbi)} item_keys referenced by hydrate are missing in results_by_item "
            f"(e.g., {missing_items_in_rbi[:5]})"
        )

    # Final flag
    has_any_assignments = len(all_theme_ids) > 0
    has_sources = (len(inventory_index) > 0) or (len(id2items) > 0) or (len(id2canon) > 0)
    no_problems = len(report["problems"]) == 0
    report["ok"] = bool(has_any_assignments and has_sources and no_problems)

    # Optional console output
    if verbose:
        print("[hydro] gold file:", gold_file_path)
        print("[hydro] ok:", report["ok"])
        print("[hydro] stats:\n", json.dumps(report["stats"], indent=2))
        if report["problems"]:
            print("[hydro] problems:")
            for p in report["problems"]:
                print("  -", p)
        # show a single bucket sample to keep logs readable
        if gold_ids:
            gid0 = gold_ids[0]
            print(f"[hydro] sample hydrated for {gid0} → {len(samples.get(gid0) or [])} themes")
            print(json.dumps(samples.get(gid0) or [], indent=2, ensure_ascii=False))

    report["samples"] = samples
    return report

# ==================== SIZE / PACKING HELPERS (ADD) ====================

MAX_BATCH_BYTES = 209_715_200  # gpt-5-mini hard cap

def _json_bytes_len(obj: Any) -> int:
    s = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    # UTF-8 byte length
    return len(s.encode("utf-8"))

def _estimate_batch_bytes(cleaned_payloads: List[dict], prompt: str = "") -> int:
    # rough but safe: prompt + payload
    base = len((prompt or "").encode("utf-8"))
    return base + _json_bytes_len(cleaned_payloads)

def _strip_scores_and_count(items: List[dict]) -> Tuple[List[dict], Dict[str, int]]:
    counts: Dict[str, int] = {}
    cleaned = []
    for it in (items or []):
        if not isinstance(it, dict):
            continue
        sb = it.get("score_bucket")
        if isinstance(sb, (int, str)) and str(sb).strip():
            k = str(sb).strip()
            counts[k] = counts.get(k, 0) + 1
        it2 = {k: v for k, v in it.items() if k not in ("relevance_score", "score_bucket")}
        # ensure stable id
        dq = (it2.get("direct_quote") or it2.get("paraphrase") or it2.get("researcher_comment") or "").strip()
        base = f"{it2.get('item_key','')}||{dq}"
        it2.setdefault("direct_quote_id", hashlib.md5(base.encode("utf-8")).hexdigest()[:10])
        cleaned.append(it2)
    return cleaned, counts

def _flatten_group_to_payloads(rq_map: dict) -> List[dict]:
    """
    rq_map shape:
      rq_map[gold][potential_theme][evidence_type][score_bucket] -> [records]
    Flatten to a single payload list of dicts for this RQ.
    """
    flat: List[dict] = []
    for _gold, ptmap in (rq_map or {}).items():
        for ptheme, etmap in (ptmap or {}).items():
            for etype, sbmap in (etmap or {}).items():
                for sb, lst in (sbmap or {}).items():
                    for rec in (lst or []):
                        r = dict(rec)
                        r["score_bucket"] = sb
                        r["evidence_type"] = etype
                        r["potential_theme"] = ptheme
                        flat.append(r)
    return flat

def _split_payloads_by_gold(rq_map: dict) -> List[Tuple[str, List[dict]]]:
    out: List[Tuple[str, List[dict]]] = []
    for gold, ptmap in (rq_map or {}).items():
        part = _flatten_group_to_payloads({gold: ptmap})
        out.append((gold, part))
    return out

def _split_payloads_by_ptheme(ptmap: dict) -> List[Tuple[str, List[dict]]]:
    out: List[Tuple[str, List[dict]]] = []
    for ptheme, etmap in (ptmap or {}).items():
        flat: List[dict] = []
        for etype, sbmap in (etmap or {}).items():
            for sb, lst in (sbmap or {}).items():
                for rec in (lst or []):
                    r = dict(rec)
                    r["score_bucket"] = sb
                    r["evidence_type"] = etype
                    r["potential_theme"] = ptheme
                    flat.append(r)
        out.append((ptheme, flat))
    return out

def _split_payloads_by_etype(etmap: dict, ptheme_name: str) -> List[Tuple[str, List[dict]]]:
    out: List[Tuple[str, List[dict]]] = []
    for etype, sbmap in (etmap or {}).items():
        flat: List[dict] = []
        for sb, lst in (sbmap or {}).items():
            for rec in (lst or []):
                r = dict(rec)
                r["score_bucket"] = sb
                r["evidence_type"] = etype
                r["potential_theme"] = ptheme_name
                flat.append(r)
        out.append((etype, flat))
    return out

def _make_custom_id(prefix: str, idx: int) -> str:
    return f"{prefix}_b{idx:04d}"

# -------- hydrate regroup from hydrated file (resolves missing ref) --------
def regroup_evidence_by_rq_theme_type_score(
    results_by_item: Dict[str, Dict[str, Any]],
    *,
    key_by_index: bool = False,                # default to question text (safer)
    top_n_per_score: int | None = None,
    score_key_format: str = "int",
    known_rqs: List[str] | None = None,        # ← pass manifest RQ list (exact text)
) -> Dict:
    """
    Build a pseudo-gold grouping from in-memory results_by_item.

    Output structure:
      groups[ rq_label ][ "NA" ][ potential_theme ][ evidence_type ][ score_bucket ] -> [records]

    Notes:
      - Prefers question text over raw indices.
      - If `known_rqs` is provided, only those labels are allowed; unknown indices/questions are dropped.
      - Prevents phantom folders like 'rq_5_*' when legacy/stale indices appear.
    """
    import re

    def _norm(s: str) -> str:
        return re.sub(r"\s+", " ", (s or "").strip().lower())

    # Build a validator map if `known_rqs` is given
    known_map = {}
    if isinstance(known_rqs, list) and known_rqs:
        known_map = {_norm(q): q for q in known_rqs}
        idx_to_q = {i: q for i, q in enumerate(known_rqs)}
    else:
        idx_to_q = {}

    SYNTH_GOLD = "( grouped without gold)"
    groups: Dict = {}

    def _score_bucket(score, fmt: str = "int") -> str:
        try:
            if score is None:
                return "5"
            val = int(score)
            if fmt == "label":
                return {5: "HIGH", 4: "MED", 3: "LOW"}.get(val, str(val))
            return str(val)
        except Exception:
            return "5"

    def _ensure_list(x):
        if x is None:
            return []
        if isinstance(x, list):
            return x
        return [x]

    def _emit(rq_label: str, ptheme: str, etype: str, score_bucket_key: str, record: dict):
        groups.setdefault(rq_label, {}) \
              .setdefault(SYNTH_GOLD, {}) \
              .setdefault(ptheme, {}) \
              .setdefault(etype, {}) \
              .setdefault(score_bucket_key, []) \
              .append(record)

    for item_key, blob in (results_by_item or {}).items():
        evs = (blob or {}).get("evidence_list") or []
        for ev in evs:
            etype = (ev.get("evidence_type") or "unspecified").strip()
            score_bucket_key = _score_bucket(ev.get("relevance_score"), fmt=score_key_format)

            pthemes = ev.get("potential_themes")
            if isinstance(pthemes, str) and pthemes.strip():
                pthemes = [pthemes.strip()]
            if not pthemes:
                pthemes = [(ev.get("potential_theme") or "").strip() or "(unspecified)"]

            # Normalized RQ labels (validated)
            rqs = _ensure_list(ev.get("relevant_rqs"))
            rq_labels: List[str] = []

            for rq in rqs:
                # dict style {index, question}
                if isinstance(rq, dict):
                    q_text = (rq.get("question") or "").strip()
                    idx = rq.get("index")

                    if q_text:
                        qn = _norm(q_text)
                        if known_map:
                            if qn in known_map:
                                rq_labels.append(known_map[qn])
                            else:
                                continue
                        else:
                            rq_labels.append(q_text)
                        continue

                    if isinstance(idx, int):
                        if idx_to_q:
                            if idx in idx_to_q:
                                rq_labels.append(idx_to_q[idx])
                            else:
                                continue
                        else:
                            if key_by_index:
                                rq_labels.append(f"rq:{idx}")
                            else:
                                continue

                # plain string (already a question)
                elif isinstance(rq, str) and rq.strip():
                    q_text = rq.strip()
                    qn = _norm(q_text)
                    if known_map:
                        if qn in known_map:
                            rq_labels.append(known_map[qn])
                        else:
                            continue
                    else:
                        rq_labels.append(q_text)

            if not rq_labels:
                continue

            # Build record and PROPAGATE gold theme if present on evidence
            rec_base = {
                "item_key": item_key,
                "direct_quote": ev.get("direct_quote"),
                "paraphrase": ev.get("paraphrase"),
                "researcher_comment": ev.get("researcher_comment"),
                "potential_theme": None,  # set below
                "evidence_type": etype,
                "relevance_score": ev.get("relevance_score"),
                "gold_theme": ev.get("gold_theme"),  # <-- propagate gold title for later inference
            }

            for ptheme in pthemes:
                ptheme = (ptheme or "").strip() or "(unspecified)"
                for rq_label in rq_labels:
                    rec2 = dict(rec_base)
                    rec2["potential_theme"] = ptheme
                    _emit(rq_label, ptheme, etype, score_bucket_key, rec2)

    # optional top-N per score bucket
    if isinstance(top_n_per_score, int) and top_n_per_score > 0:
        for rq, gmap in list(groups.items()):
            for gold, pmap in list(gmap.items()):
                for ptheme, etmap in list(pmap.items()):
                    for etype, sbmap in list(etmap.items()):
                        for sb, lst in list(sbmap.items()):
                            if len(lst) > top_n_per_score:
                                sbmap[sb] = lst[:top_n_per_score]

    return groups


# -------- Build size-aware jobs for ONE RQ (gold → theme → evidence fallback) --------
def _build_size_aware_jobs_for_single_rq(
    *,
    rq_label: str,
    rq_map: dict,
    base_prompt_builder,  # callable(purpose) -> prompt string (your existing prompt builder, or a lambda)
) -> List[Tuple[dict, str]]:
    """
    Returns list of (job, prompt_str) for just this RQ.
    Strategy:
      1) Try one monolithic job (all records in this RQ).
      2) If > cap, split by GOLD bucket.
      3) If still > cap, split each gold by potential_theme.
      4) If still > cap, split each ptheme by evidence_type.
    """
    jobs: List[Tuple[dict, str]] = []

    # 1) monolithic attempt
    payload_all = _flatten_group_to_payloads(rq_map)
    cleaned_all, _ = _strip_scores_and_count(payload_all)
    p_monolithic = base_prompt_builder("rq_monolithic")
    if _estimate_batch_bytes(cleaned_all, p_monolithic) <= MAX_BATCH_BYTES:
        jobs.append((
            {"rq_question": rq_label, "theme": "(all)", "potential_theme": "(all)",
             "evidence_type": "mixed", "route": "monolithic", "payloads": payload_all},
            p_monolithic
        ))
        return jobs

    # 2) by GOLD bucket
    for gold_name, gold_payload in _split_payloads_by_gold(rq_map):
        cleaned, _ = _strip_scores_and_count(gold_payload)
        p_gold = base_prompt_builder("gold")
        if _estimate_batch_bytes(cleaned, p_gold) <= MAX_BATCH_BYTES:
            jobs.append((
                {"rq_question": rq_label, "theme": gold_name, "potential_theme": "(all)",
                 "evidence_type": "mixed", "route": "gold", "payloads": gold_payload},
                p_gold
            ))
            continue

        # 3) by potential_theme
        ptmap = rq_map.get(gold_name) or {}
        for ptheme, ptheme_payload in _split_payloads_by_ptheme(ptmap):
            cleaned_pt, _ = _strip_scores_and_count(ptheme_payload)
            p_ptheme = base_prompt_builder("ptheme")
            if _estimate_batch_bytes(cleaned_pt, p_ptheme) <= MAX_BATCH_BYTES:
                jobs.append((
                    {"rq_question": rq_label, "theme": gold_name, "potential_theme": ptheme,
                     "evidence_type": "mixed", "route": "ptheme", "payloads": ptheme_payload},
                    p_ptheme
                ))
                continue

            # 4) by evidence_type
            etmap = ptmap.get(ptheme) or {}
            for etype, etype_payload in _split_payloads_by_etype(etmap, ptheme):
                cleaned_et, _ = _strip_scores_and_count(etype_payload)
                p_etype = base_prompt_builder("etype")
                # At this point these are usually tiny; still check
                if _estimate_batch_bytes(cleaned_et, p_etype) > MAX_BATCH_BYTES:
                    # last-ditch: split by coarse chunk size to be extra safe
                    CH = max(1, len(etype_payload) // 4)
                    for chunk in [etype_payload[i:i+CH] for i in range(0, len(etype_payload), CH)]:
                        jobs.append((
                            {"rq_question": rq_label, "theme": gold_name, "potential_theme": ptheme,
                             "evidence_type": etype, "route": "etype-chunk", "payloads": chunk},
                            p_etype
                        ))
                else:
                    jobs.append((
                        {"rq_question": rq_label, "theme": gold_name, "potential_theme": ptheme,
                         "evidence_type": etype, "route": "etype", "payloads": etype_payload},
                        p_etype
                    ))
    return jobs

# --- NEW: strip score fields + count buckets (used by size checks and enqueue) ---
# def _strip_scores_and_count(items: list[dict]) -> tuple[list[dict], dict]:
#     counts: dict[str, int] = {}
#     cleaned = []
#     for it in (items or []):
#         if not isinstance(it, dict):
#             continue
#         sb = it.get("score_bucket")
#         if isinstance(sb, (int, str)):
#             k = str(sb).strip()
#             if k:
#                 counts[k] = counts.get(k, 0) + 1
#         it2 = {k: v for k, v in it.items() if k not in ("relevance_score", "score_bucket")}
#         # ensure stable direct_quote_id
#         if not isinstance(it2.get("direct_quote_id"), str) or not it2["direct_quote_id"].strip():
#             anchor = (it2.get("direct_quote") or it2.get("paraphrase") or it2.get("researcher_comment") or "").strip()
#             base = f"{it2.get('item_key', '')}||{anchor}"
#             import hashlib
#             it2["direct_quote_id"] = hashlib.md5(base.encode("utf-8")).hexdigest()[:10]
#         cleaned.append(it2)
#     return cleaned, counts

def _estimate_job_bytes(job: dict, prompt_str: str) -> int:
    """
    Estimate the bytes for a single JSONL entry upload:
    "PROMPT:\\n{prompt}\\n\\nPAYLOAD(JSON):\\n{json(cleaned_payloads)}"
    """

    payloads = job.get("payloads", []) or []
    cleaned, _ = _strip_scores_and_count(payloads)
    # payload json
    payload_json = json.dumps(cleaned, ensure_ascii=False)
    # prompt text (roughly what we enqueue)
    prompt_text = "PROMPT:\n" + str(prompt_str) + "\n\nPAYLOAD(JSON):\n"
    # add small newline/record overhead (conservative)
    overhead = 64
    return len(prompt_text.encode("utf-8")) + len(payload_json.encode("utf-8")) + overhead


def _slug_for(s: str, n: int = 60) -> str:
    import re
    s = re.sub(r"[^A-Za-z0-9._-]+", "_", (s or "x"))
    s = re.sub(r"_+", "_", s).strip("_")
    return s[:n] if len(s) > n else s


def _group_jobs_by(jobs: list[tuple[dict, str]], key_fn):
    out: dict[tuple, list[tuple[dict, str]]] = {}
    for j in jobs:
        job, _ = j
        k = key_fn(job)
        out.setdefault(k, []).append(j)
    return out


def _size_of_group(jobs: list[tuple[dict, str]]) -> int:
    total = 0
    for job, prompt in jobs:
        total += _estimate_job_bytes(job, prompt)
    return total


def _greedy_fit(jobs: list[tuple[dict, str]], cap: int) -> list[list[tuple[dict, str]]]:
    """
    Greedy packing into sublists so each sublist byte-size <= cap.
    Keeps original ordering.
    """
    buckets: list[list[tuple[dict, str]]] = []
    cur: list[tuple[dict, str]] = []
    cur_bytes = 0
    for job, prompt in jobs:
        jb = _estimate_job_bytes(job, prompt)
        if jb > cap:
            # single job > cap → force as its own bucket (it'll still fail later, but visible)
            if cur:
                buckets.append(cur)
                cur, cur_bytes = [], 0
            buckets.append([(job, prompt)])
            continue
        if cur_bytes + jb <= cap:
            cur.append((job, prompt))
            cur_bytes += jb
        else:
            buckets.append(cur)
            cur = [(job, prompt)]
            cur_bytes = jb
    if cur:
        buckets.append(cur)
    return buckets


def _partition_jobs_to_size_caps_for_rq(
        rq_label: str,
        jobs_for_rq: list[tuple[dict, str]],
        cap: int = MAX_BATCH_BYTES,
) -> list[tuple[str, list[tuple[dict, str]]]]:
    """
    Apply hierarchical partitioning to respect size cap:
      1) GOLD (job['theme'])
      2) Route (job['route'])
      3) potential_theme
      4) evidence_type
      5) Greedy pack
    Returns list of (suffix, subgroup_jobs)
    """
    parts: list[tuple[str, list[tuple[dict, str]]]] = []

    gold_groups = _group_jobs_by(jobs_for_rq, lambda j: (j.get("theme") or "(unspecified)", "gold"))
    for (gold_title, _), gold_jobs in gold_groups.items():
        gold_slug = _slug_for(gold_title or "unspecified", 40)
        if _size_of_group(gold_jobs) <= cap:
            parts.append((f"gold__{gold_slug}", gold_jobs))
            continue

        route_groups = _group_jobs_by(gold_jobs, lambda j: (j.get("route") or "fallback", "route"))
        for (route_val, _), route_jobs in route_groups.items():
            route_slug = _slug_for(str(route_val), 20)
            if _size_of_group(route_jobs) <= cap:
                parts.append((f"gold__{gold_slug}__route__{route_slug}", route_jobs))
                continue

            ptheme_groups = _group_jobs_by(route_jobs,
                                           lambda j: ((j.get("potential_theme") or "(unspecified)"), "ptheme"))
            for (pt, _), pt_jobs in ptheme_groups.items():
                pt_slug = _slug_for(pt, 30)
                if _size_of_group(pt_jobs) <= cap:
                    parts.append((f"gold__{gold_slug}__route__{route_slug}__pt__{pt_slug}", pt_jobs))
                    continue

                etype_groups = _group_jobs_by(pt_jobs, lambda j: ((j.get("evidence_type") or "mixed"), "etype"))
                for (et, _), et_jobs in etype_groups.items():
                    et_slug = _slug_for(et, 20)
                    if _size_of_group(et_jobs) <= cap:
                        parts.append((f"gold__{gold_slug}__route__{route_slug}__pt__{pt_slug}__et__{et_slug}", et_jobs))
                        continue

                    # finally greedy pack this stubborn group
                    greedy = _greedy_fit(et_jobs, cap)
                    for gi, sub in enumerate(greedy, start=1):
                        parts.append((
                            f"gold__{gold_slug}__route__{route_slug}__pt__{pt_slug}__et__{et_slug}__g{gi:02d}",
                            sub
                        ))
    return parts


def safe_name(s: str, *, maxlen: int = 120) -> str:
    s = "" if s is None else str(s)
    s = s.strip()

    # Replace Windows-reserved characters and collapse whitespace
    s = re.sub(r'[\\/:*?"<>|]+', "_", s)
    s = re.sub(r"\s+", "_", s)

    # Convert dots to underscores to avoid trailing-dot problems
    s = s.replace(".", "_")

    # Keep conservative charset
    s = re.sub(r"[^0-9A-Za-z_-]+", "_", s)

    # Remove repeated underscores
    s = re.sub(r"_+", "_", s)

    # Strip leading/trailing underscores, dots, spaces (Windows dislikes trailing . or space)
    s = s.strip(" _.")
    if not s:
        s = "default"

    # Trim length
    if len(s) > maxlen:
        h = hashlib.sha1(s.encode("utf-8")).hexdigest()[:8]
        s = f"{s[:maxlen-9]}_{h}"

    return s

def process_themes_batches(
            batches: List[List[Dict[str, Any]]],
            *,
        collection_name: str,
        base_dir,

        section_title: str = "Cyber Attribution",
            prompt_key_seed: str = "themes_hierarchy_v1",
            prompt_key_classify: str = "themes_assign_to_gold_v1",
            ai_provider: str = "openai",
            research_questions: str = "what is cyber attribution",
        inventory_mapping: Optional[Dict[str, List[Dict[str, Any]]]] = None,



        inventory_index: Optional[Dict[str, Any]] = None,
        hydrate: Optional[Dict[str, Any]] = None,
        results_by_item: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
        """
        Two-stage flow:
          STAGE A — Seed over-arching (gold) headings using batches[0]
                     (read=False, store_only=False; synchronous).
          STAGE B — Classify remaining batches against these gold headings
                     (enqueue store_only=True; process; read=True; append directly to gold file).

        Inputs
        ------
        batches: list of pre-clustered/packed jobs. batches[0] is the seed job.

        Returns
        -------
        {
          "ok": bool,
          "seed_custom_id": str,
          "classify_custom_ids": [str, ...],
          "section_title": str,
          "gold_file_path": str,
          "seed_outline": dict | {"_error": ...},
          "overarching_themes": [str, ...],
          "classify_outputs_raw": [ {batch_index, payload}, ... ],
          "final_assignments": { gold_title: [theme_id, ...], ... },
          "leftovers": [theme_id, ...],
        }
        """


        import re as _re
        def _slug_name(s: str) -> str:
            return _re.sub(r"[^A-Za-z0-9._-]+", "_", (s or "themes")).strip("_")


        import hashlib as _hash
        def _safe_seg(s: str, limit: int = 64) -> str:
            """Windows-safe path segment: A-Z a-z 0-9 . _ -, truncated with 8-char hash suffix."""
            s = (s or "x").strip()
            s = _re.sub(r"[^A-Za-z0-9._-]+", "_", s)
            s = s.strip("._-") or "x"
            if len(s) <= limit:
                return s
            h = _hash.md5(s.encode("utf-8")).hexdigest()[:8]
            return (s[: max(8, limit - 9)] + "_" + h).strip("._-")

        SAFE_COLL = _safe_seg(collection_name, 48)
        RQ_TEXT = str(research_questions or section_title or "rq")
        RQ_SLUG = _safe_seg(RQ_TEXT, 80)
        RQ_HASH = _hash.md5(RQ_TEXT.encode("utf-8")).hexdigest()[:10]

        # All outputs stay directly in the RQ directory provided by caller.
        _OUT_DIR = base_dir
        os.makedirs(_OUT_DIR, exist_ok=True)

        # Short stem used for all filenames in this RQ bucket
        _STEM = f"{SAFE_COLL}_{RQ_HASH}"

        # Keep base_dir unchanged to preserve strict per-RQ scoping
        gold_file_path = os.path.join(_OUT_DIR, f"{_STEM}_gold.json")
        NS = f"{SAFE_COLL}_{RQ_HASH}"  # per-RQ namespace for model jobs/cache (stem only; no extra dirs)

        # --------------------------- helpers -------------------------------------
        def _make_custom_id(stage: str, idx: int) -> str:
            seed = f"{stage}:{collection_name}:{section_title}:job{idx}:{research_questions}"
            h = hashlib.md5(seed.encode("utf-8")).hexdigest()[:10]
            return f"{stage}:job{idx}:{h}"

        def _get_raw_text(resp: Any) -> str:
            """
            Return a JSON string for downstream parsing.
            Prefers inner dicts that already look like our schema (headings/assignments).
            """

            def _has_schema(d: Any) -> bool:
                return isinstance(d, dict) and any(k in d for k in ("headings", "assignments", "outline_meta", "audit"))

            # If dict, try to unwrap common wrappers first
            if isinstance(resp, dict):
                if _has_schema(resp):
                    return json.dumps(resp, ensure_ascii=False)
                for k in ("result", "response", "payload", "output"):
                    v = resp.get(k)
                    if _has_schema(v):
                        return json.dumps(v, ensure_ascii=False)

            # If first element in list/tuple is a dict with schema
            if isinstance(resp, (list, tuple)) and resp:
                v0 = resp[0]
                if isinstance(v0, dict):
                    if _has_schema(v0):
                        return json.dumps(v0, ensure_ascii=False)
                    # else dump as-is so _extract_json can try later
                    return json.dumps(v0, ensure_ascii=False)

            # Coerce to dict-like if possible and try common string fields
            obj = resp
            if not isinstance(obj, dict):
                if hasattr(resp, "model_dump"):
                    try:
                        obj = resp.model_dump()
                    except Exception:
                        obj = {}
                elif hasattr(resp, "to_dict"):
                    try:
                        obj = resp.to_dict()
                    except Exception:
                        obj = {}
                else:
                    obj = {}

            for k in ("raw_text", "text", "output_text", "response_text", "payload", "output"):
                v = obj.get(k) if isinstance(obj, dict) else None
                if isinstance(v, str) and v.strip():
                    return v

            # OpenAI Responses API style: look for text parts
            if isinstance(obj, dict):
                out = obj.get("output")
                if isinstance(out, list):
                    parts = []
                    for msg in out:
                        if isinstance(msg, dict) and isinstance(msg.get("content"), list):
                            for c in msg["content"]:
                                if isinstance(c, dict):
                                    t = c.get("text")
                                    if isinstance(t, str) and t.strip():
                                        parts.append(t)
                    if parts:
                        return "\n".join(parts).strip()

                # Chat Completions style
                choices = obj.get("choices")
                if isinstance(choices, list) and choices:
                    c0 = choices[0]
                    if isinstance(c0, dict):
                        msg = c0.get("message")
                        if isinstance(msg, dict):
                            t = msg.get("content")
                            if isinstance(t, str) and t.strip():
                                return t

            # last resort
            return str(resp) if resp is not None else ""

        def _unwrap_outline(obj: Any) -> Dict[str, Any]:
            """
            If we got a wrapper like {"provider": "...", "result": {...headings...}},
            return the inner dict that has our schema keys.
            """
            if isinstance(obj, dict):
                if any(k in obj for k in ("headings", "assignments", "outline_meta", "audit")):
                    return obj
                for k in ("result", "response", "payload", "output"):
                    v = obj.get(k)
                    if isinstance(v, dict) and any(
                            key in v for key in ("headings", "assignments", "outline_meta", "audit")):
                        return v
            return obj if isinstance(obj, dict) else {}

        def _extract_json(raw: Any) -> Dict[str, Any] | None:
            """
            Parse a single JSON object from a variety of noisy shapes:
            - dict → return as-is
            - (dict, ..) / [dict, ..] → return first dict
            - clean JSON string
            - code-fenced JSON
            - large debug strings → scan ALL balanced {...} fragments and pick the one
              that matches our schema (headings/assignments/outline_meta/audit), else
              the largest plausible dict.
            """
            # Already structured?
            if isinstance(raw, dict):
                return raw
            if isinstance(raw, (list, tuple)) and raw and isinstance(raw[0], dict):
                return raw[0]

            if not isinstance(raw, str) or not raw.strip():
                return None
            s = raw.strip()

            # Strip code fences, if any
            if s.startswith("```"):
                s = s.lstrip("`")
                nl = s.find("\n")
                s = s[nl + 1:] if nl >= 0 else s
                if s.endswith("```"):
                    s = s[:-3].strip()

            # Try direct parse
            try:
                obj = json.loads(s)
                if isinstance(obj, dict):
                    return obj
            except Exception:
                pass

            # Collect ALL balanced {...} fragments
            frags: list[str] = []
            depth = 0
            start = -1
            for i, ch in enumerate(s):
                if ch == "{":
                    if depth == 0:
                        start = i
                    depth += 1
                elif ch == "}":
                    if depth > 0:
                        depth -= 1
                        if depth == 0 and start >= 0:
                            frags.append(s[start:i + 1])

            if not frags:
                return None

            # Rank candidates: prefer ones with schema keys, then by size
            def score_obj(d: dict, raw_len: int) -> float:
                keys = ("headings", "assignments", "outline_meta", "audit", "leftovers")
                hit = sum(2 for k in keys if k in d)
                return float(hit) + raw_len * 1e-6  # tiny size tiebreak

            best = None
            best_score = -1.0
            for frag in frags:
                try:
                    obj = json.loads(frag)
                except Exception:
                    continue
                if isinstance(obj, dict):
                    sc = score_obj(obj, len(frag))
                    if sc > best_score:
                        best = obj
                        best_score = sc

            return best

        def _safe_dedup(seq):
            seen = set();
            out = []
            for x in seq or []:
                if isinstance(x, str) and x not in seen:
                    seen.add(x);
                    out.append(x)
            return out
        def _validate_llm_ids(payload: Dict[str, Any],
                              expected_ids: List[str],
                              *,
                              schema: str) -> Dict[str, Any]:
            """
            Validate that all expected theme_ids appear somewhere in the model payload,
            and detect any unexpected/unknown ids the model produced.

            schema: "seed"     -> expects headings/subheadings/leftovers
                    "classify" -> expects assignments{gold_title:[ids...]}/leftovers
            Returns: {
              "ok": bool,                     # True if no missing ids
              "missing": [..],                # expected but not found
              "unexpected": [..],             # in payload but not expected
              "seen": [..],                   # all ids collected from payload
              "schema": schema
            }
            """

            # ---- local helpers (not global) ----
            def _norm_id(x: Any) -> str | None:
                return str(x).strip() if isinstance(x, str) and x.strip() else None

            def _collect_seed_ids(obj: Dict[str, Any]) -> List[str]:
                """For themes_hierarchy_v1"""
                got: List[str] = []
                for h in (obj.get("headings") or []):
                    if not isinstance(h, dict):
                        continue
                    for tid in (h.get("members") or []):
                        tidn = _norm_id(tid)
                        if tidn:
                            got.append(tidn)
                    for sh in (h.get("subheadings") or []):
                        if not isinstance(sh, dict):
                            continue
                        for tid in (sh.get("members") or []):
                            tidn = _norm_id(tid)
                            if tidn:
                                got.append(tidn)
                for tid in (obj.get("leftovers") or []):
                    tidn = _norm_id(tid)
                    if tidn:
                        got.append(tidn)
                # keep first-seen ordering but dedup
                seen = set()
                out: List[str] = []
                for t in got:
                    if t not in seen:
                        seen.add(t)
                        out.append(t)
                return out

            def _collect_classify_ids(obj: Dict[str, Any]) -> List[str]:
                """For themes_assign_to_gold_v1"""
                got: List[str] = []
                assignments = obj.get("assignments") if isinstance(obj.get("assignments"), dict) else {}
                for _title, ids in (assignments or {}).items():
                    for tid in (ids or []):
                        tidn = _norm_id(tid)
                        if tidn:
                            got.append(tidn)
                for tid in (obj.get("leftovers") or []):
                    tidn = _norm_id(tid)
                    if tidn:
                        got.append(tidn)
                # keep first-seen ordering but dedup
                seen = set()
                out: List[str] = []
                for t in got:
                    if t not in seen:
                        seen.add(t)
                        out.append(t)
                return out

            # ---- pick collector based on schema ----
            expected = [t for t in (expected_ids or []) if isinstance(t, str)]
            E = set(expected)

            if schema == "seed":
                got = _collect_seed_ids(payload or {})
            elif schema == "classify":
                got = _collect_classify_ids(payload or {})
            else:
                got = []

            G = set(got)
            missing = [t for t in expected if t not in G]
            unexpected = sorted(list(G - E))

            return {
                "ok": len(missing) == 0,
                "missing": missing,
                "unexpected": unexpected,
                "seen": got,
                "schema": schema,
            }


        def _gold_path(collection_name: str, research_questions: str) -> str:
            rq_hash = hashlib.md5((research_questions or "").encode("utf-8")).hexdigest()[:12]
            safe_coll = "".join(ch if (ch.isalnum() or ch in "-_") else "_" for ch in collection_name)
            return f"/mnt/data/{safe_coll}_{rq_hash}.json"

        # Use caller-provided path or compute it from collection_name + hash(research_questions)

        gold_file_path = os.path.join(_OUT_DIR, f"{_STEM}_gold.json")


        # Validate jobs
        jobs: List[List[Dict[str, Any]]] = [j for j in (batches or []) if isinstance(j, list) and j]
        if not jobs:
            return {
                "ok": False,
                "seed_custom_id": "",
                "classify_custom_ids": [],
                "section_title": section_title,
                "gold_file_path": gold_file_path,
                "seed_outline": {"_error": "no_jobs"},
                "overarching_themes": [],
                "classify_outputs_raw": [],
                "final_assignments": {},
                "leftovers": [],
            }

        # ========================================================================
        # STAGE A — SEED / DEFINE GOLD HEADINGS (batches[0])  (read=False, store_only=False)
        # ========================================================================
        seed_items = jobs[0]
        seed_custom_id = _make_custom_id("gold_seed", 1)

        seed_payload = {
            "section_title": section_title,
            "batch_index": 1,
            "job_index": 1,
            "themes_inventory": [
                {
                    "theme_id": it.get("theme_id"),
                    "theme": it.get("theme"),
                    "count": int(it.get("count", 0)),
                }
                for it in seed_items
                if it and it.get("theme_id")
            ],
        }
        seed_text = json.dumps(seed_payload, ensure_ascii=False)

        resp_seed = call_models_old_backin(
            text=seed_text,
            function=prompt_key_seed,
            custom_id=seed_custom_id,
            collection_name=NS,
            read=False,
            store_only=False,
            ai=ai_provider,
        )

        # --- parse + unwrap the seed response ---
        seed_raw = _get_raw_text(resp_seed)
        seed_outline = _extract_json(seed_raw) if seed_raw else None
        seed_outline = _unwrap_outline(seed_outline)

        # ensure we carry a traceable payload even on failure
        if not isinstance(seed_outline, dict):
            seed_outline = {"_error": "json_parse_failed", "_raw": seed_raw}

        # normalize meta to actual content
        if isinstance(seed_outline, dict):
            headings = seed_outline.get("headings") or []
            meta = seed_outline.get("outline_meta") or {}
            meta["n_headings"] = len(headings)
            meta["n_input"] = len(seed_items)  # match actual input size

            seed_outline["outline_meta"] = meta

            # Persist seed/round-1 output (themes_hierarchy_v1)
            try:
                seed_out_path = os.path.join(_OUT_DIR, f"{_STEM}_{prompt_key_seed}_output.json")
                with open(seed_out_path, "w", encoding="utf-8") as _f:
                    json.dump(seed_outline, _f, ensure_ascii=False, indent=2)
            except Exception:
                pass

        # validate coverage of all seed ids
        seed_expected_ids = [
            str(it.get("theme_id")) for it in seed_items
            if isinstance(it, dict) and it.get("theme_id")
        ]
        seed_validation = _validate_llm_ids(
            seed_outline if isinstance(seed_outline, dict) else {},
            seed_expected_ids,
            schema="seed",
        )


        # extract over-arching titles from headings[].title
        overarching_titles: List[str] = []
        if isinstance(seed_outline, dict) and isinstance(seed_outline.get("headings"), list):
            for h in seed_outline["headings"]:
                if isinstance(h, dict):
                    t = str(h.get("title") or "").strip()
                    if t:
                        overarching_titles.append(t)
        overarching_titles = _safe_dedup(overarching_titles)

        # deterministically mint gold theme_ids from titles (NO 'gold' prefix)
        import re, hashlib
        def _make_gold_theme_id(title: str) -> str:
            slug = re.sub(r"[^a-z0-9]+", "-", (title or "").lower()).strip("-")
            h = hashlib.md5((title or "").encode("utf-8")).hexdigest()[:8]
            return f"{slug}_{h}"

        # build the objects we will pass to the classifier (id + title)
        overarching_themes_for_prompt = [
            {"theme_id": _make_gold_theme_id(t), "title": t}
            for t in overarching_titles
        ]
        gold_theme_id_list = [g["theme_id"] for g in overarching_themes_for_prompt]
        gold_theme_map = {g["theme_id"]: g["title"] for g in overarching_themes_for_prompt}  # id -> title

        # initialize the gold JSON on disk (store both ids and titles)
        # --- Build hydration locals (from parameters or derived from all batches) ---
        inv_local: Dict[str, Dict[str, Any]] = {}
        if isinstance(inventory_index, dict) and inventory_index:
            inv_local = dict(inventory_index)
        else:
            # derive from ALL batches (max count per theme_id)
            for batch in (batches or []):
                for it in (batch or []):
                    if not isinstance(it, dict):
                        continue
                    tid = str(it.get("theme_id") or "").strip()
                    if not tid:
                        continue
                    if tid not in inv_local:
                        inv_local[tid] = {"theme": it.get("theme"), "count": 0}
                    c = it.get("count", 0)
                    c_int = int(c) if (isinstance(c, int) or (isinstance(c, str) and c.isdigit())) else 0
                    if c_int > int(inv_local[tid].get("count", 0)):
                        inv_local[tid]["count"] = c_int

        hyd_local: Dict[str, Any] = dict(hydrate) if isinstance(hydrate, dict) else {}
        if not isinstance(hyd_local.get("id_to_items"), dict):
            hyd_local["id_to_items"] = {}
        if not isinstance(hyd_local.get("id_to_canon_members"), dict):
            hyd_local["id_to_canon_members"] = {}

        rbi_local: Dict[str, Any] = dict(results_by_item) if isinstance(results_by_item, dict) else {}
        invmap_local: Dict[str, Any] = dict(inventory_mapping) if isinstance(inventory_mapping, dict) else {}

        # initialize the gold JSON on disk (store both ids/titles AND hydration sources)
        gold_json = {
            "section_title": section_title,
            "collection_name": collection_name,
            "research_questions": research_questions,
            "seed_outline": seed_outline,
            "overarching_themes": overarching_themes_for_prompt,  # [{theme_id, title}, ...]
            "overarching_theme_ids": gold_theme_id_list,  # [id, ...]
            "gold_theme_map": gold_theme_map,  # id -> title
            "assignments": {tid: [] for tid in gold_theme_id_list},
            "leftovers": [],
            "history": [{"stage": "seed", "custom_id": seed_custom_id}],
            # NEW: persist hydration sources up front
            "hydration_sources": {
                "inventory_index": inv_local,
                "hydrate": hyd_local,
                "results_by_item": rbi_local,
                "inventory_mapping": invmap_local,  # NEW
            },
        }
        os.makedirs(os.path.dirname(gold_file_path) or ".", exist_ok=True)
        with open(gold_file_path, "w", encoding="utf-8") as f:
            json.dump(gold_json, f, ensure_ascii=False, indent=2)

        print(f"[seed] wrote gold → {gold_file_path}")

        # --- Seed-time themes-only (so downstream can proceed even before Stage B) ---
        try:
            themes_only_seed = {
                "section_title": section_title,
                "collection_name": collection_name,
                "research_questions": research_questions,
                "overarching_themes": gold_json.get("overarching_themes", []),  # [{theme_id,title}]
                "overarching_theme_ids": gold_json.get("overarching_theme_ids", []),
                "gold_theme_map": gold_json.get("gold_theme_map", {}),  # id -> title
                "hydration_sources": {
                    "inventory_index": gold_json.get("hydration_sources", {}).get("inventory_index", {}),
                    "hydrate": gold_json.get("hydration_sources", {}).get("hydrate", {}),
                    "inventory_mapping": gold_json.get("hydration_sources", {}).get("inventory_mapping", {}),
                    # omit results_by_item here to keep it light
                },
            }
            themes_only_path = os.path.join(os.path.dirname(gold_file_path), f"{_STEM}_themes_only.json")
            with open(themes_only_path, "w", encoding="utf-8") as _f:
                json.dump(themes_only_seed, _f, ensure_ascii=False, indent=2)
            print(f"[seed] wrote themes_only → {themes_only_path}")
        except Exception as _e:
            themes_only_path = ""
            print(f"[seed][warn] could not write themes_only: {_e}")

        # (keep a second best-effort write of gold.json, as in your original)
        try:
            os.makedirs(os.path.dirname(gold_file_path) or ".", exist_ok=True)
            with open(gold_file_path, "w", encoding="utf-8") as f:
                json.dump(gold_json, f, ensure_ascii=False, indent=2)
        except Exception as e:
            gold_json["_file_write_error"] = f"{e!r}"

        # ========================================================================
        # STAGE B — CLASSIFY REMAINING BATCHES INTO GOLD HEADINGS
        # ========================================================================
        # ---------- JSON extractors (stage-specific) ----------

        def _extract_json_seed(raw: Any) -> dict | None:
            """
            Expect keys like: headings / subheadings / leftovers / outline_meta / audit
            """
            if isinstance(raw, dict):
                return raw
            if isinstance(raw, (list, tuple)) and raw and isinstance(raw[0], dict):
                return raw[0]
            if not isinstance(raw, str) or not raw.strip():
                return None

            s = _strip_code_fences(raw)
            s = _maybe_tuple_unwrap(s)

            # try direct
            obj = _try_parse_json(s)
            if obj is not None:
                return obj

            # scan fragments and prefer hierarchy keys
            frags = _json_candidates_from_string(s)
            cands = [o for f in frags if (o := _try_parse_json(f)) is not None]
            return _pick_best_candidate(
                cands,
                prefer_keys=("headings", "leftovers", "outline_meta", "audit", "subheadings"),
            )

        def _extract_json_classify(raw: Any) -> dict | None:
            """
            Expect keys like: assignments / assignments_list / leftovers / audit / outline_meta
            """
            if isinstance(raw, dict):
                return raw
            if isinstance(raw, (list, tuple)) and raw and isinstance(raw[0], dict):
                return raw[0]
            if not isinstance(raw, str) or not raw.strip():
                return None

            s = _strip_code_fences(raw)
            s = _maybe_tuple_unwrap(s)

            # try direct
            obj = _try_parse_json(s)
            if obj is not None:
                return obj

            # scan fragments and prefer classify keys
            frags = _json_candidates_from_string(s)
            cands = [o for f in frags if (o := _try_parse_json(f)) is not None]
            return _pick_best_candidate(
                cands,
                prefer_keys=("assignments", "assignments_list", "audit", "leftovers", "outline_meta"),
            )

        # ------------------------------------------------------------------------
        # Debug controls
        # ------------------------------------------------------------------------
        DEBUG_PRINT = False
        DEBUG_PAUSE = False # flip to False to skip input() pauses

        def _dbg(msg: str):
            if DEBUG_PRINT:
                print(msg)

        def _pp(obj, max_chars: int = 8000):
            try:
                s = json.dumps(obj, ensure_ascii=False, indent=2)
            except Exception:
                s = str(obj)
            print(s if len(s) <= max_chars else s[:max_chars] + "\n...<truncated>...")

        # ------------------------------------------------------------------------
        # Prepare classification jobs and gold headings
        # ------------------------------------------------------------------------
        classify_custom_ids: List[str] = [
            _make_custom_id("gold_classify", b_idx) for b_idx, _ in enumerate(jobs[1:], start=2)
        ]
        classify_outputs_raw: List[Dict[str, Any]] = []

        # Build the gold list we will pass to the model (ID + title, NO counts).
        # Prefer the ids/titles minted during seed; otherwise derive from seed_outline.
        if "gold_theme_map" in locals() and isinstance(gold_theme_map, dict) and gold_theme_map:
            id_to_title = dict(gold_theme_map)  # gold_id -> title
            overarching_theme_ids = list(id_to_title.keys())
        else:
            def _make_gold_theme_id(title: str) -> str:
                slug = re.sub(r"[^a-z0-9]+", "-", (title or "").lower()).strip("-")
                h = hashlib.md5((title or "").encode("utf-8")).hexdigest()[:8]
                return f"{slug}_{h}"

            id_to_title = {}
            for h in (seed_outline.get("headings") or []):
                if isinstance(h, dict):
                    t = str(h.get("title") or "").strip()
                    if t:
                        gid = _make_gold_theme_id(t)
                        id_to_title[gid] = t
            overarching_theme_ids = list(id_to_title.keys())

        overarching_themes_for_prompt = [
            {"theme_id": gid, "title": id_to_title[gid]}
            for gid in overarching_theme_ids
        ]

        _dbg("\n[Stage B] GOLD THEMES to classify into (id -> title):")
        _pp(id_to_title)
        if DEBUG_PAUSE:
            input("↑ Verify gold themes (press Enter to continue)")

        # ------------------------------------------------------------------------
        # Ensure the consolidated gold file exists & has the expected scaffold
        # Also persist hydration sources from Stage A if present in globals()
        # ------------------------------------------------------------------------
        def _ensure_gold_file_initialized() -> Dict[str, Any]:
            base = {
                "section_title": section_title,
                "collection_name": collection_name,
                "research_questions": research_questions,
                "seed_outline": seed_outline,
                "overarching_themes": [{"theme_id": gid, "title": id_to_title[gid]} for gid in overarching_theme_ids],
                "overarching_theme_ids": overarching_theme_ids[:],
                "gold_theme_map": id_to_title.copy(),  # id -> title
                "assignments": {gid: [] for gid in overarching_theme_ids},
                "leftovers": [],
                "history": [{"stage": "seed", "custom_id": seed_custom_id}],
                "hydration_sources": {
                    # use the locals we just built above (not globals)
                    "inventory_index": inv_local,
                    "hydrate": hyd_local,
                    "results_by_item": rbi_local,
                },
            }

            cur: Dict[str, Any] = {}
            if os.path.exists(gold_file_path):
                with open(gold_file_path, "r", encoding="utf-8") as f:
                    cur = json.load(f)

            # Merge scaffold keys if missing
            cur.setdefault("section_title", base["section_title"])
            cur.setdefault("collection_name", base["collection_name"])
            cur.setdefault("research_questions", base["research_questions"])
            cur.setdefault("seed_outline", base["seed_outline"])
            cur.setdefault("overarching_themes", base["overarching_themes"])
            cur.setdefault("overarching_theme_ids", base["overarching_theme_ids"])
            cur.setdefault("gold_theme_map", base["gold_theme_map"])
            cur.setdefault("assignments", {gid: [] for gid in overarching_theme_ids})
            cur.setdefault("leftovers", [])
            cur.setdefault("history", base["history"])

            # hydration_sources: if absent, write our locals; if present, keep but ensure shapes
            hs = cur.get("hydration_sources")
            if not isinstance(hs, dict):
                hs = {}
            if "inventory_index" not in hs or not isinstance(hs["inventory_index"], dict):
                hs["inventory_index"] = inv_local
            if "hydrate" not in hs or not isinstance(hs["hydrate"], dict):
                hs["hydrate"] = hyd_local
            else:
                # ensure shapes
                if "id_to_items" not in hs["hydrate"] or not isinstance(hs["hydrate"]["id_to_items"], dict):
                    hs["hydrate"]["id_to_items"] = {}
                if "id_to_canon_members" not in hs["hydrate"] or not isinstance(hs["hydrate"]["id_to_canon_members"],
                                                                                dict):
                    hs["hydrate"]["id_to_canon_members"] = {}
            if "results_by_item" not in hs or not isinstance(hs["results_by_item"], dict):
                hs["results_by_item"] = rbi_local
            if "inventory_mapping" not in hs or not isinstance(hs["inventory_mapping"], dict):
                hs["inventory_mapping"] = invmap_local
            cur["hydration_sources"] = hs

            for gid in overarching_theme_ids:
                cur["assignments"].setdefault(gid, [])

            os.makedirs(os.path.dirname(gold_file_path) or ".", exist_ok=True)
            with open(gold_file_path, "w", encoding="utf-8") as f:
                json.dump(cur, f, ensure_ascii=False, indent=2)

            return cur

        gold_json = _ensure_gold_file_initialized()
        _dbg(f"\n[Stage B] Initialized/verified gold file scaffold at: {gold_file_path}")
        if DEBUG_PAUSE:
            input("↑ Scaffold check (press Enter to continue)")

        # ------------------------------------------------------------------------
        # Try to reuse already-completed batch output BEFORE enqueuing.
        # ------------------------------------------------------------------------
        prehydrated = _process_batch_for(
            function=prompt_key_classify,
            collection_name=NS,
            wait=False,
            download_if_ready=True,
        )

        _dbg(f"[Stage B] prehydrated={prehydrated}")

        # ------------------------------------------------------------------------
        # Enqueue jobs only if we didn't already have a completed batch on disk.
        # ------------------------------------------------------------------------
        if not prehydrated:
            for b_idx, items in enumerate(jobs[1:], start=2):
                custom_id = classify_custom_ids[b_idx - 2]  # keep stable order
                text = (
                        "overarching_themes:\n"
                        + json.dumps(overarching_themes_for_prompt, ensure_ascii=False)
                        + "\n\n\n"
                        + "themes_inventory:\n"
                        + json.dumps(
                    [
                        {
                            "theme_id": it.get("theme_id"),
                            "theme": it.get("theme"),
                            "count": int(it.get("count", 0)),
                        }
                        for it in items
                        if it and it.get("theme_id")
                    ],
                    ensure_ascii=False,
                )
                )
                _dbg(f"\n[Stage B] Enqueue batch b{b_idx} custom_id={custom_id} items={len(items)}")
                _ = call_models_old_backin(
                    text=text,
                    function=prompt_key_classify,
                    custom_id=custom_id,
                    collection_name=NS,
                    read=False,
                    store_only=True,
                    ai=ai_provider,
                )

            if DEBUG_PAUSE:
                input("↑ All classification jobs enqueued (press Enter to poll & read)")

        # ------------------------------------------------------------------------
        # Submit (or rehydrate) and read each job, merging into the gold JSON
        # ------------------------------------------------------------------------
        ok_classify = True
        if classify_custom_ids:
            ok_classify = _process_batch_for(
                function=prompt_key_classify,
                collection_name=NS,
                wait=True,
                download_if_ready=True,
            )

            _dbg(f"[Stage B] batch completed ok_classify={ok_classify}")

            if ok_classify:
                for b_idx, _items in enumerate(jobs[1:], start=2):
                    cid = classify_custom_ids[b_idx - 2]
                    _dbg(f"\n[Stage B] Reading batch b{b_idx} custom_id={cid}")
                    resp = call_models_old_backin(
                        text="",
                        function=prompt_key_classify,
                        custom_id=cid,
                        collection_name=NS,
                        read=True,
                        store_only=False,
                        ai=ai_provider,
                    )

                    # ---- Robust payload extraction ----
                    payload: Dict[str, Any] | None = None
                    if isinstance(resp, dict):
                        for k in ("result", "response", "payload", "output"):
                            v = resp.get(k)
                            if isinstance(v, dict) and any(
                                    kk in v for kk in ("assignments", "assignments_list", "audit", "outline_meta")
                            ):
                                payload = v
                                break
                        if payload is None and any(
                                kk in resp for kk in ("assignments", "assignments_list", "audit", "outline_meta")
                        ):
                            payload = resp
                    elif isinstance(resp, (list, tuple)) and resp and isinstance(resp[0], dict):
                        payload = resp[0]
                    else:
                        raw_text = _get_raw_text_classify(resp)
                        payload = _extract_json_classify(raw_text)
                        if not isinstance(payload, dict):
                            classify_outputs_raw.append({
                                "batch_index": b_idx,
                                "payload": {"_error": "json_parse_failed", "_raw": raw_text},
                            })
                            _dbg(f"[Stage B] b{b_idx} ERROR: could not parse payload; head:")
                            print((raw_text or "")[:400])
                            if DEBUG_PAUSE:
                                input("↑ Parse error (press Enter to continue)")
                            continue

                    # Validate expected ids for this batch
                    batch_items = jobs[b_idx - 1]  # because enumerate start=2 on jobs[1:]
                    batch_expected_ids = [
                        str(it.get("theme_id")) for it in batch_items
                        if isinstance(it, dict) and it.get("theme_id")
                    ]
                    classify_validation = _validate_llm_ids(
                        payload, batch_expected_ids, schema="classify"
                    )
                    _dbg(f"[Stage B] b{b_idx} validation:")
                    _pp(classify_validation, max_chars=4000)

                    classify_outputs_raw.append({
                        "batch_index": b_idx,
                        "payload": payload,
                        "validation": classify_validation,
                    })

                    # Load current gold file (best-effort without exceptions)
                    if os.path.exists(gold_file_path):
                        with open(gold_file_path, "r", encoding="utf-8") as f:
                            gold_current = json.load(f)
                    else:
                        gold_current = gold_json

                    # Ensure scaffolding remains intact
                    gold_current.setdefault("gold_theme_map", id_to_title.copy())
                    gold_current.setdefault("overarching_theme_ids", list(id_to_title.keys()))
                    gold_current.setdefault("overarching_themes", [
                        {"theme_id": gid, "title": id_to_title[gid]}
                        for gid in gold_current["overarching_theme_ids"]
                    ])
                    gold_current.setdefault(
                        "assignments",
                        {gid: [] for gid in gold_current["overarching_theme_ids"]},
                    )
                    gold_current.setdefault("leftovers", [])
                    gold_current.setdefault("history", [{"stage": "seed", "custom_id": seed_custom_id}])
                    gold_current.setdefault("hydration_sources", gold_current.get("hydration_sources", {}))

                    id_to_title = gold_current["gold_theme_map"]
                    title_to_id = {v: k for k, v in id_to_title.items()}

                    # Snapshot counts BEFORE merge
                    before_counts = {gid: len(gold_current["assignments"].get(gid, []))
                                     for gid in gold_current["overarching_theme_ids"]}

                    # ---- Mirror assignments_list to assignments if needed ----
                    assignments = payload.get("assignments") if isinstance(payload.get("assignments"), dict) else {}
                    if not assignments and isinstance(payload.get("assignments_list"), list):
                        assignments = {}
                        for row in payload["assignments_list"]:
                            if not isinstance(row, dict):
                                continue
                            gid = row.get("theme_id")
                            ttl = row.get("title")
                            members = [m for m in (row.get("members") or []) if isinstance(m, str)]
                            key = gid if isinstance(gid, str) and gid in id_to_title else (
                                ttl if isinstance(ttl, str) and ttl in title_to_id else None
                            )
                            if key is not None:
                                assignments.setdefault(key, []).extend(members)

                    _dbg(f"[Stage B] b{b_idx} incoming assignments (keys): {list(assignments.keys())}")
                    if DEBUG_PAUSE:
                        input("↑ Inspect incoming assignment keys (press Enter to merge)")

                    # ---- Merge assignments (prefer gold ids; accept titles) ----
                    for key, ids in (assignments or {}).items():
                        if not isinstance(key, str) or not key.strip():
                            continue
                        if key in id_to_title:
                            canonical_id = key
                        elif key in title_to_id:
                            canonical_id = title_to_id[key]
                        else:
                            print(f"[warn] unknown assignment key from model: {key!r} (skipping)")
                            continue

                        gold_current["assignments"].setdefault(canonical_id, [])
                        gold_current["assignments"][canonical_id].extend(
                            [str(i) for i in (ids or []) if isinstance(i, str)]
                        )
                        gold_current["assignments"][canonical_id] = _safe_dedup(
                            gold_current["assignments"][canonical_id]
                        )

                    # ---- Merge leftovers ----
                    if isinstance(payload.get("leftovers"), list):
                        gold_current["leftovers"].extend(
                            [str(i) for i in payload["leftovers"] if isinstance(i, str)]
                        )
                        gold_current["leftovers"] = _safe_dedup(gold_current["leftovers"])

                    # Snapshot counts AFTER merge + compute deltas
                    after_counts = {gid: len(gold_current["assignments"].get(gid, []))
                                    for gid in gold_current["overarching_theme_ids"]}
                    deltas = {gid: after_counts[gid] - before_counts[gid]
                              for gid in gold_current["overarching_theme_ids"]
                              if after_counts[gid] != before_counts[gid]}

                    _dbg(f"[Stage B] b{b_idx} deltas (added members by gold_id):")
                    _pp(deltas, max_chars=2000)

                    # Print the members just added (per gold bucket)
                    for gid, d in deltas.items():
                        if d <= 0:
                            continue
                        tail = gold_current["assignments"][gid][-d:]
                        _dbg(f"  + {gid} ({id_to_title.get(gid, gid)}): added {d} items")
                        _pp(tail, max_chars=2000)

                    if DEBUG_PAUSE:
                        input("↑ Batch merge summary shown (press Enter to persist)")

                    # ---- Update history & persist after EACH batch ----
                    hist = gold_current.get("history", [])
                    hist.append({"stage": "classify_read", "custom_id": cid})
                    gold_current["history"] = hist

                    os.makedirs(os.path.dirname(gold_file_path) or ".", exist_ok=True)
                    with open(gold_file_path, "w", encoding="utf-8") as f:
                        json.dump(gold_current, f, ensure_ascii=False, indent=2)
                    gold_json = gold_current  # keep in-memory in sync

                    _dbg(f"[Stage B] b{b_idx} persisted to {gold_file_path}")
                    if DEBUG_PAUSE:
                        input("↑ Persisted current batch (press Enter to continue)")

        # ------------------------------------------------------------------------
        # Read back the final gold JSON (best-effort; no exceptions)
        # ------------------------------------------------------------------------
        if os.path.exists(gold_file_path):
            with open(gold_file_path, "r", encoding="utf-8") as f:
                gold_final = json.load(f)
        else:
            gold_final = gold_json

        # Ensure every gold id is present & deduped
        final_assignments = gold_final.get("assignments", {}) or {}
        for gid in gold_final.get("overarching_theme_ids", []):
            final_assignments.setdefault(gid, [])
            final_assignments[gid] = _safe_dedup(final_assignments[gid])

        # ------------------------------------------------------------------------
        # Final debug printout + HYDRATION (replace theme_ids with full items)
        # Load hydration sources from the gold file if present, otherwise create safe fallbacks
        # ------------------------------------------------------------------------
        hydration_sources = gold_final.get("hydration_sources", {}) if isinstance(gold_final, dict) else {}
        _inventory_index = hydration_sources.get("inventory_index") if isinstance(hydration_sources, dict) else {}
        _hydrate = hydration_sources.get("hydrate") if isinstance(hydration_sources, dict) else {}
        _results_by_item = hydration_sources.get("results_by_item") if isinstance(hydration_sources, dict) else {}
        _inventory_mapping = hydration_sources.get("inventory_mapping") if isinstance(hydration_sources, dict) else {}
        if not isinstance(_inventory_index, dict):
            _inventory_index = {}
        if not isinstance(_hydrate, dict):
            _hydrate = {}
        if not isinstance(_results_by_item, dict):
            _results_by_item = {}

        # Fallback: derive a minimal inventory_index from the batches if nothing was persisted
        if not _inventory_index:
            inv_tmp: Dict[str, Dict[str, Any]] = {}
            for batch in (jobs or []):
                for it in (batch or []):
                    if not isinstance(it, dict):
                        continue
                    tid = str(it.get("theme_id") or "").strip()
                    if not tid:
                        continue
                    if tid not in inv_tmp:
                        inv_tmp[tid] = {"theme": it.get("theme"), "count": 0}
                    c = it.get("count", 0)
                    # best-effort int conversion
                    c_int = 0
                    if isinstance(c, (int, float)):
                        c_int = int(c)
                    elif isinstance(c, str) and c.strip().isdigit():
                        c_int = int(c.strip())
                    if c_int > int(inv_tmp[tid].get("count", 0)):
                        inv_tmp[tid]["count"] = c_int
            _inventory_index = inv_tmp

        # --------------------------- HYDRATION HELPERS ---------------------------

        def _norm_text(s: str) -> str:
            # normalize for fuzzy compare (token-set like)
            s = s.lower()
            out = []
            prev_alnum = False
            for ch in s:
                if ch.isalnum():
                    out.append(ch)
                    prev_alnum = True
                else:
                    if prev_alnum:
                        out.append(" ")
                        prev_alnum = False
            return " ".join("".join(out).split())

        def _theme_token_set(s: str) -> set:
            return set(_norm_text(s).split()) if isinstance(s, str) and s.strip() else set()

        def _theme_match(candidate: str, target: str) -> bool:
            """
            Token-set fuzzy match:
              - exact normalized equality OR
              - Jaccard-like overlap >= 0.6 of token sets
            """
            if not isinstance(candidate, str) or not isinstance(target, str):
                return False
            a = _theme_token_set(candidate)
            b = _theme_token_set(target)
            if not a or not b:
                return False
            if a == b:
                return True
            inter = len(a & b)
            denom = max(len(a), len(b))
            return (inter / float(denom)) >= 0.6

        def _find_payloads_by_theme(theme: str,
                                    results_by_item: Dict[str, Any]) -> List[Dict[str, Any]]:
            """
            Scan all items in results_by_item and return full bundles whose evidence_list
            contains 'potential_themes' mentioning `theme` (fuzzy token match).
            """
            if not isinstance(theme, str) or not theme.strip():
                return []
            out: List[Dict[str, Any]] = []
            seen_keys: set = set()
            for item_key, bundle in (results_by_item or {}).items():
                if not isinstance(bundle, dict):
                    continue
                ev_list = bundle.get("evidence_list") or []
                found = False
                for ev in ev_list:
                    if not isinstance(ev, dict):
                        continue
                    pts = ev.get("potential_themes") or []
                    for tag in (pts if isinstance(pts, list) else []):
                        if isinstance(tag, str) and _theme_match(tag, theme):
                            found = True
                            break
                    if found:
                        break
                if found and item_key not in seen_keys:
                    out.append({
                        "item_key": item_key,
                        "metadata": bundle.get("metadata", {}),
                        "evidence_list": bundle.get("evidence_list", []),
                    })
                    seen_keys.add(item_key)
            return out

        def _find_payloads_by_theme_id(theme_id: str) -> List[Dict[str, Any]]:
            """
            Look up human-readable theme label for `theme_id` and return matched bundles.
            """
            if not isinstance(theme_id, str) or not theme_id.strip():
                return []
            label = ""
            if theme_id in (_inventory_index or {}):
                label = str((_inventory_index.get(theme_id) or {}).get("theme") or "")
            # If no label found, nothing to match in results_by_item
            if not label:
                return []
            return _find_payloads_by_theme(label, _results_by_item)

        def _hydrate_theme(theme_id: str) -> dict:
            tid = str(theme_id or "")
            inv = (_inventory_index or {}).get(tid, {})  # {"theme","count"}
            label = inv.get("theme") if isinstance(inv, dict) else ""
            item_keys = (_hydrate.get("id_to_items") or {}).get(tid, []) or []

            items_full = []
            # NEW: prefer the pre-built full payloads if present
            invmap_items = (_inventory_mapping or {}).get(tid)
            if isinstance(invmap_items, list) and invmap_items:
                items_full = invmap_items
            elif item_keys:
                # Fast, deterministic path via item_keys + results_by_item
                for k in item_keys:
                    b = (_results_by_item or {}).get(k, {})
                    if isinstance(b, dict) and b:
                        items_full.append({
                            "item_key": k,
                            "metadata": b.get("metadata", {}),
                            "evidence_list": b.get("evidence_list", []),
                        })
                    else:
                        items_full.append({"item_key": k})  # placeholder
            else:
                # Fallback: fuzzy find by theme label over results_by_item
                items_full = _find_payloads_by_theme(label, _results_by_item) if label else []

            return {
                "theme_id": tid,
                "theme": str(label) if label else None,
                "count": inv.get("count"),
                "items": items_full
            }

        hydrated_only_path = None
        meta_path = None
        hydration_ok = False
        hydration_stats = {}
        # gold_id -> [hydrated theme objects with full items]
        hydrated_assignments: Dict[str, List[Dict[str, Any]]] = {
            gid: [_hydrate_theme(tid) for tid in (final_assignments.get(gid) or [])]
            for gid in (gold_final.get("overarching_theme_ids") or [])
        }

        _dbg("\n[Stage B] FINAL gold assignments (hydrated to full results_by_item payloads):")
        _pp(hydrated_assignments)

        hydrated_leftovers = [_hydrate_theme(t) for t in (gold_final.get("leftovers") or [])]
        _dbg("\n[Stage B] FINAL leftovers (hydrated):")
        _pp(hydrated_leftovers)

        # Safe access to hydration audit (prevents NameError if checker not wired)
        __hr = locals().get("_hydration_report") or {}
        hydration_ok = bool(__hr.get("ok"))
        hydration_stats = __hr.get("stats", {})

        # Resolve output directory dynamically:
        # 1) prefer base_dir if given; 2) else gold_file_path folder; 3) else CWD
        out_dir = base_dir or (os.path.dirname(gold_file_path) if gold_file_path else os.getcwd())
        os.makedirs(out_dir, exist_ok=True)

        # Final file paths (short + safe via _STEM)
        hydrated_only_path = os.path.join(out_dir, f"{_STEM}_themes_only.json")
        meta_path = os.path.join(out_dir, f"{_STEM}_themes_meta.json")

        from datetime import datetime as _dt

        # (1) hydrated-only view: overarching themes + hydrated members only
        slim_hydrated = {
            "section_title": gold_final.get("section_title"),
            "collection_name": gold_final.get("collection_name"),
            "overarching_themes": gold_final.get("overarching_themes", []),
            "gold_theme_map": gold_final.get("gold_theme_map", {}),
            "overarching_theme_ids": gold_final.get("overarching_theme_ids", []),
            "generated_at": _dt.utcnow().isoformat() + "Z",
            "hydrated_assignments": hydrated_assignments,
        }
        with open(hydrated_only_path, "w", encoding="utf-8") as f:
            json.dump(slim_hydrated, f, ensure_ascii=False, indent=2)

        # (2) meta/rest view: everything else (history, audits, hydration sources, etc.)
        meta_rest = dict(gold_final)
        meta_rest.pop("hydrated_assignments", None)
        meta_rest.pop("hydrated_leftovers", None)
        meta_rest.setdefault("audit", {})
        meta_rest["audit"]["hydration_ok"] = hydration_ok
        meta_rest["audit"]["hydration_stats"] = hydration_stats

        with open(meta_path, "w", encoding="utf-8") as f:
            json.dump(meta_rest, f, ensure_ascii=False, indent=2)

        print(f"[split] wrote hydrated-only → {hydrated_only_path}")
        print(f"[split] wrote meta/rest     → {meta_path}")

        # (3) write classify (round-2) outputs as JSONL
        classify_jsonl = os.path.join(out_dir, f"{_STEM}_{prompt_key_classify}_output.jsonl")
        with open(classify_jsonl, "w", encoding="utf-8") as f:
            for row in classify_outputs_raw:
                try:
                    f.write(json.dumps(row, ensure_ascii=False) + "\n")
                except Exception:
                    # be resilient to any non-serializable fragment
                    f.write(json.dumps({"_error": "serialize_failed"}, ensure_ascii=False) + "\n")

        # (4) persist results_by_item if we have it (mirrors extract_* export)
        if rbi_local:
            rbi_path = os.path.join(out_dir, f"{_STEM}_results_by_item.json")
            with open(rbi_path, "w", encoding="utf-8") as f:
                json.dump(rbi_local or {}, f, ensure_ascii=False, indent=2)
        else:
            rbi_path = None

        # (5) manifest of everything we created
        manifest = {
            "collection_name": collection_name,
            "section_title": section_title,
            "research_questions": research_questions,
            "paths": {
                "gold_json": gold_file_path,
                "hydrated_only": hydrated_only_path,
                "meta": meta_path,
                "seed_round1_json": os.path.join(out_dir, f"{_STEM}_{prompt_key_seed}_output.json"),
"classify_round2_jsonl": classify_jsonl,
"results_by_item": rbi_path,
"inventory_index": os.path.join(out_dir, f"{_STEM}_inventory_index.json"),
"inventory_mapping": os.path.join(out_dir, f"{_STEM}_inventory_mapping.json"),

            },
        }
        with open(os.path.join(out_dir, "manifest.json"), "w", encoding="utf-8") as f:
            json.dump(manifest, f, ensure_ascii=False, indent=2)



        _hydration_report = debug_check_hydration(gold_file_path, jobs=jobs, sample_per_bucket=3, verbose=True)
        gold_final.setdefault("audit", {})["hydration_ok"] = bool((_hydration_report or {}).get("ok"))
        gold_final["audit"]["hydration_stats"] = (_hydration_report or {}).get("stats", {})


        try:
            with open(gold_file_path, "w", encoding="utf-8") as f:
                json.dump(gold_final, f, ensure_ascii=False, indent=2)
        except Exception as _e:
            print("[warn] could not persist hydration audit:", _e)
        # --------------------------- RETURN ---------------------------
        return {
            "ok": bool(isinstance(seed_outline, dict) and ok_classify),
            "seed_custom_id": seed_custom_id,
            "classify_custom_ids": classify_custom_ids,
            "section_title": section_title,
            "gold_file_path": gold_file_path,
            "seed_outline": seed_outline,
            "overarching_themes": gold_final.get("overarching_themes", []),  # [{theme_id, title}, ...]
            "classify_outputs_raw": classify_outputs_raw,

            "hydrated_only_path": locals().get("hydrated_only_path"),
            "meta_path": locals().get("meta_path"),
            "hydration_ok": bool(locals().get("hydration_ok")),
            "hydration_stats": locals().get("hydration_stats", {}),

            "final_assignments": final_assignments,  # {gold_id: [th_...], ...}
            "leftovers": gold_final.get("leftovers", []),
            "hydrated_assignments": hydrated_assignments,
            "hydrated_leftovers": hydrated_leftovers,
            "outputs_dir": _OUT_DIR,
            "classify_jsonl_path": locals().get("classify_jsonl"),
            "results_by_item_path": locals().get("rbi_path"),
            "manifest_path": os.path.join(_OUT_DIR, "manifest.json"),

            # NEW: simple paths block so callers/manifest can hoist them
            "paths": {
                "gold_file_path": gold_file_path,
                "themes_only": locals().get("themes_only_path") or os.path.join(os.path.dirname(gold_file_path),
                                                                                f"{_STEM}_themes_only.json"),
                "hydrated_only": locals().get("hydrated_only_path"),
                "meta": locals().get("meta_path"),
                "classify_jsonl": locals().get("classify_jsonl"),
                "results_by_item": locals().get("rbi_path"),
            },
        }



def _assign_theme_ids(themes: List[str] | Any) -> Dict[str, str]:
    """
    Deterministic, stable IDs based on SHA1 of canonical theme string.
    """
    out = {}
    for t in themes:
        h = hashlib.sha1(t.encode("utf-8")).hexdigest()[:10]
        out[t] = f"th_{h}"
    return out


def _finalize_theme_catalog(
    theme_catalog_raw: Dict[str, Dict[str, Any]],
    theme_variants: Dict[str, set],
    theme_id_map: Dict[str, str],
) -> Dict[str, Any]:
    out = {}
    for canon, stats in theme_catalog_raw.items():
        variants = sorted(set(theme_variants.get(canon, [])), key=str.lower)
        display = variants[0] if variants else canon
        out[canon] = {
            "theme_id": theme_id_map[canon],
            "display": display,
            "df_items": int(stats["df_items"]),
            "n_evidence": int(stats["n_evidence"]),
            "items": sorted(list(stats["items"])),
            "variants": variants,
        }
    return out


# ------------------------------------------------------------
# Heuristic merges (no LLM)
# ------------------------------------------------------------
def _token_set(s: str) -> set:
    s = re.sub(r"[^a-z0-9\s\-]", " ", s.lower())
    s = re.sub(r"\s+", " ", s).strip()
    return set(s.split()) if s else set()


def _token_jaccard(a: str, b: str) -> float:
    A = _token_set(a)
    B = _token_set(b)
    if not A or not B:
        return 0.0
    inter = len(A & B)
    union = len(A | B)
    return inter / union if union else 0.0


def _heuristic_merge_synonyms(themes: List[str], threshold: float = 0.88) -> Dict[str, str]:
    """
    Simple near-duplicate merger by token-set Jaccard similarity.
    Builds groups greedily: shortest canonical wins.
    Returns a mapping alias -> canonical.
    """
    if not themes:
        return {}

    canons = sorted(set(themes), key=lambda s: (len(s), s))
    canon_for = {t: t for t in canons}
    consumed = set()

    for i, a in enumerate(canons):
        if a in consumed:
            continue
        for b in canons[i+1:]:
            if b in consumed:
                continue
            sim = _token_jaccard(a, b)
            if sim >= threshold:
                # map b -> a (shortest first guarantees a is "smaller" or equal)
                canon_for[b] = a
                consumed.add(b)

    # Build alias map (exclude identity mappings)
    alias_map = {}
    for t, c in canon_for.items():
        if t != c:
            alias_map[t] = c
    return alias_map


def _fold_synonyms(
    theme_catalog: Dict[str, Any],
    theme_id_map: Dict[str, str],
    synonym_map: Dict[str, str],
) -> Tuple[Dict[str, Any], Dict[str, str]]:
    """
    Collapse alias themes into their canonical:
      - merge counts, items, variants
      - reassign theme_id to canonical only
    """
    if not synonym_map:
        return theme_catalog, theme_id_map

    # Reverse view: canonical -> [aliases]
    buckets = defaultdict(list)
    for alias, canonical in synonym_map.items():
        buckets[canonical].append(alias)

    new_catalog = dict(theme_catalog)
    for canonical, aliases in buckets.items():
        if canonical not in new_catalog:
            # In case LLM picked a canonical that didn't exist:
            new_catalog[canonical] = {
                "theme_id": theme_id_map.get(canonical, _assign_theme_ids([canonical])[canonical]),
                "display": canonical,
                "df_items": 0,
                "n_evidence": 0,
                "items": [],
                "variants": [canonical],
            }

        for alias in aliases:
            if alias not in theme_catalog:
                continue
            # merge stats
            new_catalog[canonical]["df_items"] += theme_catalog[alias]["df_items"]
            new_catalog[canonical]["n_evidence"] += theme_catalog[alias]["n_evidence"]
            new_catalog[canonical]["items"] = sorted(
                set(new_catalog[canonical]["items"]) | set(theme_catalog[alias]["items"])
            )
            new_catalog[canonical]["variants"] = sorted(
                set(new_catalog[canonical]["variants"]) | set(theme_catalog[alias]["variants"])
            )
            # drop alias
            if alias in new_catalog:
                del new_catalog[alias]

    # Rebuild theme_id_map so aliases point to canonical ID
    new_id_map = {}
    for t in theme_id_map:
        c = synonym_map.get(t, t)
        # all aliases now share canonical's ID
        canonical_id = _assign_theme_ids([c])[c]
        new_id_map[t] = canonical_id

    # Ensure all canonicals exist in id map
    for c in new_catalog.keys():
        if c not in new_id_map:
            new_id_map[c] = _assign_theme_ids([c])[c]

    return new_catalog, new_id_map


# ------------------------------------------------------------
# Optional LLM-merge phase (uses your `call_models`)
# ------------------------------------------------------------
def _build_llm_merge_batches(
    theme_catalog: Dict[str, Any],
    all_evidence: List[Dict[str, Any]],
    batch_size: int = 60,
) -> Tuple[List[List[Dict[str, Any]]], Dict[str, int]]:
    """
    Prepare small JSON payloads for the model:
      [{ "term": "<theme>", "count": <df>, "examples": ["short quote", ...] }, ...]
    Batched deterministically by descending document frequency.
    """
    # Map theme -> sample quotes
    samples: Dict[str, List[str]] = defaultdict(list)
    for ev in all_evidence:
        for th in (ev.get("potential_themes") or []):
            c = _canon_theme(th)
            if c and len(samples[c]) < 3 and ev.get("direct_quote"):
                # keep quotes short-ish
                q = ev["direct_quote"].strip()
                q = re.sub(r"\s+", " ", q)
                if len(q) > 240:
                    q = q[:237].rstrip() + "…"
                samples[c].append(q)

    items = []
    for canon, info in theme_catalog.items():
        items.append({
            "term": info.get("display") or canon,
            "canonical": canon,
            "count": int(info.get("df_items", 0)),
            "examples": samples.get(canon, [])[:3],
        })

    # Sort by descending count, then lexicographically by canonical
    items.sort(key=lambda x: (-x["count"], x["canonical"]))

    # Chunk
    batches = []
    for i in range(0, len(items), max(1, int(batch_size))):
        batches.append(items[i:i+batch_size])

    # Index map (useful for debugging)
    idx_map = {it["canonical"]: i for i, it in enumerate(items)}
    return batches, idx_map


def _run_llm_merge(
    batches: List[List[Dict[str, Any]]],
    *,
    ai_provider_key: str = "openai",
    model_name: str = "gpt-5-mini",
    section_title: str,
    verbose: bool = False,
) -> Tuple[List[Dict[str, Any]], List[Any]]:
    """
    For each batch: send a strict JSON-only prompt. No external schema required.
    Expects the model to return:
      {
        "merges": [
           {"canonical": "<string>", "synonyms": ["<alias1>", "<alias2>", ...]}
        ]
      }
    """
    llm_payloads = []
    raw_responses = []

    for idx, batch in enumerate(batches, start=1):
        payload = {
            "instruction": (
                "You will receive a JSON array of theme candidates with their approximate document frequency "
                "and up to 3 short quotes. Your task is ONLY to identify near-duplicate or synonymous themes and "
                "output STRICT JSON with a 'merges' array. Do not invent new themes; only merge existing ones. "
                "Choose the most natural/short form as the canonical. Return {} if no merges."
            ),
            "section_title": section_title,
            "batch_index": idx,
            "items": batch
        }
        prompt_text = (
            "Return STRICT JSON ONLY.\n\n"
            "TASK:\n"
            "Identify near-duplicate/synonymous themes in the provided batch.\n"
            "Rules:\n"
            " - Use existing terms only; do not create new themes.\n"
            " - Prefer the shortest natural phrasing as 'canonical'.\n"
            " - If no merges, return {\"merges\": []}.\n"
            " - JSON only; no prose, no markdown.\n\n"
            f"INPUT JSON:\n{json.dumps(payload, ensure_ascii=False, indent=2)}\n\n"
            "OUTPUT JSON SCHEMA:\n"
            "{\n"
            "  \"merges\": [\n"
            "    {\"canonical\": \"string\", \"synonyms\": [\"string\", \"string\", ...]}\n"
            "  ]\n"
            "}\n"
        )

        # Use your call_models_old_backin() directly. We pass raw text so full_prompt is the text.
        try:
            res = call_models_old_backin(
                text=prompt_text,
                function="theme_merge_pass1",
                custom_id=f"theme-merge-{section_title}-{idx}",
                collection_name="__themes__",  # harmless label for logs
                read=False,
                store_only=False,
                ai=ai_provider_key,
                models={"openai": model_name} if ai_provider_key == "openai" else {},
            )
            raw_responses.append(res)
            # 'res' may be a dict or provider-wrapped; normalize:
            # In your call_models for openai, it tends to return parsed JSON directly if schema set;
            # here we didn't set schema, so it returns provider dict or a string.
            if isinstance(res, tuple) and len(res) >= 1 and isinstance(res[0], (dict, list)):
                # safety: some branches return (result, False)
                candidate = res[0]
            else:
                candidate = res

            # Extract raw text if needed
            # For safety, try to find JSON in strings/dicts
            merges_obj = _try_extract_json(candidate)
            if merges_obj and isinstance(merges_obj, dict) and "merges" in merges_obj:
                llm_payloads.append(merges_obj)
            else:
                if verbose:
                    print(f"[LLM merge] batch {idx}: could not parse merges; skipping.")
        except Exception as e:
            if verbose:
                print(f"[LLM merge] batch {idx} exception: {e!r}")

    return llm_payloads, raw_responses


def _try_extract_json(obj: Any) -> Optional[Dict[str, Any]]:
    """
    Best-effort JSON extraction from various response shapes.
    """
    try:
        if isinstance(obj, dict) and ("merges" in obj):
            return obj
        if isinstance(obj, str):
            s = obj.strip()
            # Try direct JSON
            try:
                return json.loads(s)
            except Exception:
                pass
            # Try to locate a JSON object substring
            m = re.search(r"\{.*\}", s, flags=re.S)
            if m:
                return json.loads(m.group(0))
        # Some provider wrappers: {"provider": "...", "response": "..."} or similar
        if isinstance(obj, dict):
            for k in ("response", "raw_text", "text"):
                v = obj.get(k)
                if isinstance(v, str):
                    try:
                        return json.loads(v)
                    except Exception:
                        m = re.search(r"\{.*\}", v or "", flags=re.S)
                        if m:
                            return json.loads(m.group(0))
        if isinstance(obj, (list, tuple)):
            # Look for dict with "merges"
            for x in obj:
                j = _try_extract_json(x)
                if isinstance(j, dict) and "merges" in j:
                    return j
        return None
    except Exception:
        return None


def _apply_llm_merges(
    llm_payloads: List[Dict[str, Any]],
    allowed_themes: set[str],
) -> Dict[str, str]:
    """
    Convert model merges into a synonym map alias->canonical (canonical & synonyms are strings).
    Ignore items not in allowed_themes (safety).
    """
    alias_map = {}
    for p in llm_payloads:
        merges = p.get("merges") or []
        for block in merges:
            canonical = _canon_theme(block.get("canonical"))
            if not canonical or canonical not in allowed_themes:
                continue
            for syn in (block.get("synonyms") or []):
                alias = _canon_theme(syn)
                if alias and alias in allowed_themes and alias != canonical:
                    alias_map[alias] = canonical
    return alias_map


# ------------------------------------------------------------
# Hierarchy construction (theme → subthemes → evidence)
# ------------------------------------------------------------
def _choose_parent_theme(
    canon_themes: List[str],
    *,
    df_map: Dict[str, int],
    primary_strategy: str = "first",
) -> str:
    """
    Select parent theme for a given evidence record:
      - "first": use the first theme in the list
      - "max_df": use the theme with highest doc frequency
    """
    if not canon_themes:
        return ""
    if primary_strategy == "max_df":
        # sort by df desc, tiebreaker by term
        return sorted(canon_themes, key=lambda t: (-int(df_map.get(t, 0)), t))[0]
    # default "first"
    return canon_themes[0]


def regroup_evidence_by_rq_theme_type_score_from_hydrated(
    *,
    themes_only_path: str,
    top_n_per_score: int | None = None,
    score_key_format: str = "int",          # "int" or "label"
    known_rqs: list[str] | None = None,     # optional sanity-check; file is per-RQ
    key_by_index: bool = False,             # unused here; kept for signature parity
) -> dict:
    """
    Build groups directly from a per-RQ hydrated themes file with:
      - section_title
      - gold_theme_map: {gold_id -> gold_title}
      - hydrated_assignments: { gold_id: [ {theme_id, theme, count, items:[{item_key, metadata, evidence_list:[...] }]} ] }

    Output:
      groups[rq_label][gold_title][potential_theme][evidence_type][score_bucket] -> [records]

    Improvements vs. old version:
      - Handles multiple potential_themes per evidence (not just the first).
      - Normalises evidence_type to a small vocabulary (fallback "mixed").
      - Supports score_key_format="label" → {"high","medium","low"}.
      - Mints direct_quote_id when missing (stable from item_key + content).
      - Resilient to missing fields; preserves metadata; propagates per-evidence gold_theme if present.
    """


    def _norm_ws(s: str) -> str:
        return re.sub(r"\s+", " ", (s or "").strip())

    def _score_bucket(score, fmt: str = "int") -> str:
        try:
            v = int(score)
        except Exception:
            v = 5
        v = max(1, min(5, v))
        if fmt == "label":
            if v >= 5:
                return "high"
            if v >= 3:
                return "medium"
            return "low"
        return str(v)

    ET_ALLOWED = {
        "finding","claim","limitation","example","method","framework",
        "policy_position","recommendation","quote","anecdote","evidence","mixed"
    }
    def _norm_etype(x: Any) -> str:
        s = (str(x or "")).strip().lower()
        return s if s in ET_ALLOWED else ("mixed" if s else "mixed")

    def _ensure_list(x):
        if x is None:
            return []
        if isinstance(x, list):
            return x
        return [x]

    def _mint_dqid(item_key: str, ev: dict) -> str:
        anchor = (ev.get("direct_quote") or ev.get("paraphrase") or ev.get("researcher_comment") or "").strip()
        base = f"{item_key}||{anchor}"
        return hashlib.md5(base.encode("utf-8")).hexdigest()[:10]

    # ---------- load ----------
    if not (isinstance(themes_only_path, str) and os.path.isfile(themes_only_path)):
        return {}

    with open(themes_only_path, "r", encoding="utf-8") as f:
        obj = json.load(f) or {}

    rq_label = _norm_ws(obj.get("section_title") or "(unknown RQ)")

    # Optional sanity-check against known RQs
    if isinstance(known_rqs, list) and known_rqs:
        known_norm = {_norm_ws(q).lower(): q for q in known_rqs}
        rq_norm = rq_label.lower()
        if rq_norm in known_norm:
            rq_label = known_norm[rq_norm]

    gold_map = obj.get("gold_theme_map") or {}
    hydrated = obj.get("hydrated_assignments") or {}

    # groups[rq][gold][ptheme][etype][sb] -> list(records)
    groups: dict = {rq_label: {}}

    # ---------- walk GOLD buckets ----------
    for gold_id, theme_bins in (hydrated.items() if isinstance(hydrated, dict) else []):
        gold_title = _norm_ws(gold_map.get(gold_id) or gold_id or "(gold)")

        for tbin in (theme_bins or []):
            if not isinstance(tbin, dict):
                continue
            bin_theme_label = _norm_ws(tbin.get("theme") or "")
            items = _ensure_list(tbin.get("items"))

            for it in items:
                if not isinstance(it, dict):
                    continue
                item_key = it.get("item_key")
                meta = it.get("metadata") or {}
                evs = _ensure_list(it.get("evidence_list"))

                for ev in evs:
                    if not isinstance(ev, dict):
                        continue

                    # Potential themes: prefer per-evidence list; fall back to per-evidence single; else bin label
                    pts = ev.get("potential_themes")
                    if isinstance(pts, str) and pts.strip():
                        pts = [pts.strip()]
                    if not pts:
                        single = (ev.get("potential_theme") or "").strip()
                        pts = [single] if single else []
                    if not pts:
                        pts = [bin_theme_label or "(unspecified)"]

                    etype = _norm_etype(ev.get("evidence_type"))
                    sb = _score_bucket(ev.get("relevance_score"), score_key_format)

                    dqid = ev.get("direct_quote_id")
                    if not isinstance(dqid, str) or not dqid.strip():
                        dqid = _mint_dqid(item_key or "", ev)

                    # Build base record once
                    rec_base = {
                        "item_key": item_key,
                        "metadata": meta,
                        "gold_theme": ev.get("gold_theme") or gold_title,  # prefer explicit per-evidence override
                        "evidence_type": etype,
                        "relevance_score": ev.get("relevance_score"),
                        "score_bucket": sb,
                        "direct_quote_id": dqid,
                        "direct_quote": ev.get("direct_quote"),
                        "paraphrase": ev.get("paraphrase"),
                        "researcher_comment": ev.get("researcher_comment"),
                    }

                    # Emit for each potential theme (don’t collapse to first only)
                    for pt in pts:
                        ptheme = _norm_ws(pt) or "(unspecified)"
                        groups \
                            .setdefault(rq_label, {}) \
                            .setdefault(gold_title, {}) \
                            .setdefault(ptheme, {}) \
                            .setdefault(etype, {}) \
                            .setdefault(sb, []) \
                            .append({**rec_base, "potential_theme": ptheme})

    # ---------- optional cap per score bucket ----------
    if isinstance(top_n_per_score, int) and top_n_per_score > 0:
        for gold_map2 in groups.get(rq_label, {}).values():
            for ptmap in gold_map2.values():
                for etmap in ptmap.values():
                    for sb, lst in list(etmap.items()):
                        if len(lst) > top_n_per_score:
                            etmap[sb] = lst[:top_n_per_score]

    return groups

def _slug_for_coll(s: str) -> str:
    import re
    s = re.sub(r"[^A-Za-z0-9._-]+", "_", (s or "default"))
    s = re.sub(r"_+", "_", s)
    return s.strip("_")[:80]

def _estimate_bytes(text: str) -> int:
    return len(text.encode("utf-8"))

class _BatchRow(BaseModel):
    rq: str = Field(default="")
    rq_question: str = Field(default="")
    gold_theme: str = Field(default="(merged_small_themes)")
    overarching_theme: str = Field(default="(merged_small_themes)")
    route: str = Field(default="fallback")
    item_key: Optional[str] = Field(default=None)
    direct_quote_id: Optional[str] = Field(default=None)
    direct_quote: Optional[str] = Field(default=None)
    paraphrase: Optional[str] = Field(default=None)
    researcher_comment: Optional[str] = Field(default=None)
    evidence_type: str = Field(default="mixed")
    evidence_type_norm: str = Field(default="mixed")
    potential_theme: str = Field(default="(unspecified)")
    payload_theme: str = Field(default="(unspecified)")
    score_bucket: Optional[str] = Field(default=None)
    relevance_score: Optional[float] = Field(default=None)
    payload_json: Optional[str] = Field(default=None)
    page: Optional[int] = Field(default=None)
    section_title: Optional[str] = Field(default=None)
    section_text: Optional[str] = Field(default=None)
    author_summary: Optional[str] = Field(default=None)
    first_author_last: Optional[str] = Field(default=None)
    year: Optional[str] = Field(default=None)
    title: Optional[str] = Field(default=None)
    source: Optional[str] = Field(default=None)
    url: Optional[str] = Field(default=None)

def regroup_all_rqs_from_manifest(
    manifest_path: str,
    *,
    top_n_per_score: int | None = None,
    score_key_format: str = "int",
    batches_json_path: Optional[str] = None,
) -> Dict[str, Any]:
    from copy import deepcopy

    with open(manifest_path, "r", encoding="utf-8") as f:
        mani = json.load(f) or {}

    outputs = mani.get("outputs") or []
    merged: Dict[str, Any] = {}

    def _merge(dst: Dict[str, Any], src: Dict[str, Any]) -> None:
        # deep 5-level nested merge: rq -> gold -> ptheme -> etype -> score_bucket -> list
        for rq, gold_map in (src or {}).items():
            d_rq = dst.setdefault(rq, {})
            for gold, pt_map in (gold_map or {}).items():
                d_gold = d_rq.setdefault(gold, {})
                for ptheme, et_map in (pt_map or {}).items():
                    d_pt = d_gold.setdefault(ptheme, {})
                    for etype, sb_map in (et_map or {}).items():
                        d_et = d_pt.setdefault(etype, {})
                        for sb, lst in (sb_map or {}).items():
                            d_et.setdefault(sb, []).extend(deepcopy(lst or []))

    for out in outputs:
        paths = out.get("paths") or {}

        rbi_per_rq = paths.get("results_by_item_per_rq")
        if rbi_per_rq and os.path.isfile(rbi_per_rq):
            per = regroup_evidence_by_rq_theme_type_score_from_rbi(
                results_by_item_path=rbi_per_rq,
                top_n_per_score=top_n_per_score,
                score_key_format=score_key_format,
            )
            _merge(merged, per)
            continue

        rbi_any = paths.get("results_by_item") or paths.get("results_by_item_path")
        if rbi_any and os.path.isfile(rbi_any):
            per = regroup_evidence_by_rq_theme_type_score_from_rbi(
                results_by_item_path=rbi_any,
                top_n_per_score=top_n_per_score,
                score_key_format=score_key_format,
            )
            _merge(merged, per)
            continue

        hydrated = paths.get("hydrated_only") or paths.get("themes_only")
        if hydrated and os.path.isfile(hydrated):
            per = regroup_evidence_by_rq_theme_type_score_from_hydrated(
                themes_only_path=hydrated,
                top_n_per_score=top_n_per_score,
            )
            _merge(merged, per)

    def _count(rq_map: Dict[str, Any]) -> int:
        tot = 0
        for _g, pmap in (rq_map or {}).items():
            for _p, etmap in (pmap or {}).items():
                for _e, sbmap in (etmap or {}).items():
                    for _s, lst in (sbmap or {}).items():
                        tot += len(lst or [])
        return tot

    merged = {rq: m for rq, m in (merged or {}).items() if _count(m) > 0}

    if isinstance(batches_json_path, str) and batches_json_path.strip():
        rows: List[Dict[str, Any]] = _flatten_regroup_to_batches_rows(merged)
        os.makedirs(os.path.dirname(batches_json_path), exist_ok=True)
        tmp = batches_json_path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(rows, f, ensure_ascii=False, indent=2)
        os.replace(tmp, batches_json_path)

    return merged
def _flatten_regroup_to_batches_rows(merged: Dict[str, Any]) -> List[Dict[str, Any]]:



    rows: List[Dict[str, Any]] = []

    def _norm_str(x: Any, default: str = "") -> str:
        s = str(x).strip() if isinstance(x, str) else (str(x).strip() if x is not None else "")
        return s or default

    for rq, gold_map in (merged or {}).items():
        rq_label = _norm_str(rq)
        for gold, pt_map in (gold_map or {}).items():
            gold_label = _norm_str(gold, "(merged_small_themes)")
            for ptheme, et_map in (pt_map or {}).items():
                ptheme_label = _norm_str(ptheme, "(unspecified)")
                for etype, sb_map in (et_map or {}).items():
                    etype_norm = _norm_str(etype or "mixed").lower() or "mixed"
                    for sb, lst in (sb_map or {}).items():
                        sbucket = _norm_str(sb)
                        for rec in (lst or []):
                            payload_copy = json.dumps(rec, ensure_ascii=False)
                            row = _BatchRow(
                                rq=rq_label,
                                rq_question=rq_label,
                                gold_theme=gold_label,
                                overarching_theme=gold_label,
                                route=_norm_str(rec.get("route"), "fallback"),
                                item_key=_norm_str(rec.get("item_key")) or None,
                                direct_quote_id=_norm_str(rec.get("direct_quote_id")) or None,
                                direct_quote=_norm_str(rec.get("direct_quote")) or None,
                                paraphrase=_norm_str(rec.get("paraphrase")) or None,
                                researcher_comment=_norm_str(rec.get("researcher_comment")) or None,
                                evidence_type=etype_norm or "mixed",
                                evidence_type_norm=etype_norm or "mixed",
                                potential_theme=ptheme_label,
                                payload_theme=_norm_str(rec.get("payload_theme"), ptheme_label),
                                score_bucket=sbucket or None,
                                relevance_score=rec.get("relevance_score"),
                                payload_json=payload_copy,
                                page=rec.get("page"),
                                section_title=_norm_str(rec.get("section_title")) or None,
                                section_text=_norm_str(rec.get("section_text")) or None,
                                author_summary=_norm_str(rec.get("author_summary")) or None,
                                first_author_last=_norm_str(rec.get("first_author_last")) or None,
                                year=_norm_str(rec.get("year")) or None,
                                title=_norm_str(rec.get("title")) or None,
                                source=_norm_str(rec.get("source")) or None,
                                url=_norm_str(rec.get("url")) or None,
                            ).model_dump()
                            rows.append(row)
    return rows



def _score_bucket(score: Any, *, fmt: str = "int") -> str:
    """Map numeric score to a stable bucket label."""
    try:
        v = int(score)
    except Exception:
        return "scores_3_2_1"  # default to low if missing
    if v >= 4:
        return "scores_5_4"
    return "scores_3_2_1"

# def _ensure_list(x):
#     if x is None:
#         return []
#     if isinstance(x, list):
#         return x
#     return [x]

from pydantic import BaseModel, Field

class _DirectQuoteEntry(BaseModel):
    dqid: str = Field(min_length=1)
    text: str = Field(default="")

def build_direct_quote_lookup_from_jobs(
    jobs: List[Tuple[dict, str]]
) -> Dict[str, str]:
    """
    Build a simple mapping: direct_quote_id -> direct_quote text.

    This is what hydration/postprocess expects:
      {
        "e2dbc16117": "Since cyberattacks frequently leave no evidence, attribution ...",
        "cdecc93dc6": "difficulties come from the complexity of cyber-attacks ...",
        ...
      }

    We prefer the verbatim `direct_quote`. If that's missing,
    we fall back to `paraphrase`, then `researcher_comment`.
    """
    out: Dict[str, str] = {}

    for batch_obj, _marker in (jobs or []):
        payloads = (batch_obj or {}).get("payloads", []) or []
        for p in payloads:
            if not isinstance(p, dict):
                continue

            dqid_raw = p.get("direct_quote_id")
            dqid = (str(dqid_raw).strip() if dqid_raw is not None else "")
            if not dqid:
                continue

            direct_q = p.get("direct_quote")
            paraphrase = p.get("paraphrase")
            comment = p.get("researcher_comment")

            if isinstance(direct_q, str) and direct_q.strip():
                chosen = direct_q.strip()
            elif isinstance(paraphrase, str) and paraphrase.strip():
                chosen = paraphrase.strip()
            elif isinstance(comment, str) and comment.strip():
                chosen = comment.strip()
            else:
                chosen = ""

            entry = _DirectQuoteEntry(dqid=dqid, text=chosen)
            out[entry.dqid] = entry.text

    return out


class _PageRef(BaseModel):
    page: int | None = None
    section_title: str | None = None
    section_html: str | None = None

def _make_page_index_for_record(rec: Dict[str, Any]) -> Dict[str, Dict[str, Dict[str, Any]]]:
    """
    Build the minimal per-record page index that postprocess_html_with_quotes_and_apa()
    expects in order to append ', p. X' to the APA string.

    Shape:
      {
        "<item_key>": {
          "<direct_quote_text>": { "page": 12 }
        }
      }
    """
    item_key_raw = rec.get("item_key")
    item_key = str(item_key_raw).strip() if item_key_raw is not None else ""

    quote_text_raw = rec.get("direct_quote") or rec.get("paraphrase") or ""
    quote_text = str(quote_text_raw).strip()

    page_raw = rec.get("page")
    if isinstance(page_raw, int):
        page_val = page_raw
    elif isinstance(page_raw, str) and page_raw.strip().isdigit():
        page_val = int(page_raw.strip())
    else:
        page_val = None

    if not item_key or not quote_text:
        return {}

    return {
        item_key: {
            quote_text: {
                "page": page_val
            }
        }
    }
import re
import html as _html
from typing import Dict, Any
import pandas as pd


def _inject_anchor_dqid_text(
    html_text: str,
    item_key: str,
    dqid: str,
    dq_lookup: Dict[str, Any],
) -> str:
    """
    Update an existing citation anchor or create one if missing.

    Behaviour:
      1. Look for <a ... data-key="item_key" ...>.
      2. Add data-dqid="..." to it.
      3. Replace title="..." with direct-quote text from dq_lookup[dqid].
      4. If no such anchor exists, append a new one at the end of html_text.
    """
    text = html_text if isinstance(html_text, str) else ""
    ik = item_key if isinstance(item_key, str) else ""
    dq = dqid if isinstance(dqid, str) else ""

    print("[INJECT] raw_html:", text)
    print("[INJECT] item_key:", repr(ik), "dqid:", repr(dq))

    if not text:
        print("[INJECT] empty html_text, returning empty string")
        return ""

    dqtxt = ""
    if isinstance(dq_lookup, dict) and dq:
        raw = dq_lookup.get(dq)
        print("[INJECT] dq_lookup[dqid]:", raw)
        if isinstance(raw, dict):
            for key in ("direct_quote", "direct_quote_clean", "quote_text"):
                val = raw.get(key)
                if isinstance(val, str) and val.strip():
                    dqtxt = val.strip()
                    break
        elif isinstance(raw, str):
            dqtxt = raw.strip()

    dqtxt = dqtxt or dq
    dqtxt_safe = dqtxt.replace('"', "&quot;")

    print("[INJECT] direct_quote_text:", dqtxt)

    pat = r'<a\b([^>]*\bdata-key="' + re.escape(ik) + r'"[^>]*)>'

    def repl(m: "re.Match[str]") -> str:
        attrs = m.group(1)
        print("[INJECT] matched anchor attrs:", attrs)

        attrs = re.sub(r'\bdata-dqid="[^"]*"', "", attrs, flags=re.IGNORECASE)
        attrs += ' data-dqid="' + _html.escape(dq, quote=True) + '"'

        attrs = re.sub(r'\btitle="[^"]*"', "", attrs, flags=re.IGNORECASE)
        attrs += ' title="' + dqtxt_safe + '"'

        attrs = re.sub(r'\s+', " ", attrs).strip()
        if attrs and not attrs.startswith(" "):
            attrs = " " + attrs

        patched = "<a" + attrs + ">"
        print("[INJECT] patched anchor:", patched)
        return patched

    new_text = re.sub(pat, repl, text, count=1, flags=re.IGNORECASE)

    if new_text != text:
        print("[INJECT] updated html_text:", new_text)
        return new_text

    extra = (
        '<a data-key="'
        + _html.escape(ik, quote=True)
        + '" data-dqid="'
        + _html.escape(dq, quote=True)
        + '" title="'
        + dqtxt_safe
        + '"></a>'
    )
    appended = text + extra
    print("[INJECT] no existing anchor found, appended anchor:", extra)
    print("[INJECT] final html_text:", appended)
    return appended


def hydrate_one_section_record(
    rec: Dict[str, Any],
    df: pd.DataFrame,
    dq_lookup: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Take one raw section dict from sections.json and return a new dict with a clean
    'section_html' field.

    Steps:
      1. Start from rec['section_text'] (fallback: rec['section_html']).
      2. If we have item_key + direct_quote_id, update or inject an anchor so that
         it has data-dqid and title equal to the direct quote text, then hydrate
         APA + page via postprocess_html_with_quotes_and_apa.
      3. If we do NOT have item_key/direct_quote_id, treat section_html as already-final
         and leave it untouched (no extra anchor or hydration).
      4. Print full debug for rec, intermediate html, page_index, and hydrated_final.
    """
    raw_block = rec.get("section_text") or rec.get("section_html") or ""
    raw_html = str(raw_block)

    def _strip_wrapped_quotes(val) -> str:
        s = str(val) if val is not None else ""
        s = s.strip()
        if len(s) >= 2 and ((s[0] == s[-1] == '"') or (s[0] == s[-1] == "'")):
            return s[1:-1].strip()
        return s

    dqid = _strip_wrapped_quotes(rec.get("direct_quote_id"))
    item_key = _strip_wrapped_quotes(rec.get("item_key"))

    if not item_key and isinstance(raw_html, str) and raw_html:
        if "data-key" in raw_html:
            keys_from_html = collect_item_keys_from_html(raw_html)
            if keys_from_html:
                item_key = keys_from_html[0]
        if not item_key:
            href_pattern = re.compile(
                r'\bhref\s*=\s*("([^"]*)"|\'([^\']*)\')',
                flags=re.IGNORECASE | re.DOTALL,
            )
            for m in href_pattern.finditer(raw_html):
                v = m.group(2) if m.group(2) is not None else m.group(3)
                candidate = _strip_wrapped_quotes(v)
                if candidate:
                    item_key = candidate
                    break

    df_cols: list = []
    df_rows = ""
    if df is not None:
        cols_attr = getattr(df, "columns", None)
        if cols_attr is not None:
            df_cols = [str(c) for c in list(cols_attr)]
        shape_attr = getattr(df, "shape", None)
        if shape_attr is not None and len(shape_attr) > 0:
            df_rows = str(shape_attr[0])

    # print("[HYDRATE] full rec:", rec)
    # print("[HYDRATE] item_key:", repr(item_key), "dqid:", repr(dqid))
    # print("[HYDRATE] raw_html:", raw_html)
    # print("[HYDRATE] df_rows:", df_rows, "df_cols:", df_cols)

    if not item_key and not dqid:
        print("[HYDRATE] no item_key/dqid, returning section_html as-is")
        new_rec = dict(rec)
        new_rec["section_html"] = raw_html
        return new_rec

    step1_html = _inject_anchor_dqid_text(
        raw_html,
        item_key=item_key,
        dqid=dqid,
        dq_lookup=dq_lookup,
    )
    print("[HYDRATE] step1_html after _inject_anchor_dqid_text:", step1_html)

    page_index = _make_page_index_for_record(rec)
    print("[HYDRATE] page_index:", page_index)

    hydrated_final = postprocess_html_with_quotes_and_apa(
        step1_html,
        direct_quote_lookup=dq_lookup,
        df=df,

    )
    print("[HYDRATE] hydrated_final:", hydrated_final)

    new_rec = dict(rec)
    new_rec["section_html"] = hydrated_final
    return new_rec





def hydrate_sections_records(
    sections: List[Dict[str, Any]],
    df: pd.DataFrame,
    dq_lookup: Dict[str, str],
) -> List[Dict[str, Any]]:
    """
    ###1. map hydrate_one_section_record over sections
    """
    hydrated_list: List[Dict[str, Any]] = []
    for rec in sections:
        hydrated_list.append(hydrate_one_section_record(rec, df, dq_lookup))
    return hydrated_list



class _AnchorModel(BaseModel):
    raw_attrs: str = Field(default="")
    item_key: str = Field(default="")
    dqid: str = Field(default="")
    title: str = Field(default="")
    inner_text: str = Field(default="")

def collect_item_keys_from_html(html_str: str) -> list[str]:
    if not isinstance(html_str, str) or not html_str:
        return []
    attr_re = re.compile(r'\bdata-key\s*=\s*("([^"]*)"|\'([^\']*)\')', flags=re.IGNORECASE | re.DOTALL)
    keys: list[str] = []
    seen = set()
    for m in attr_re.finditer(html_str):
        v = m.group(2) if m.group(2) is not None else m.group(3)
        k = (v or "").strip()
        if k and k not in seen:
            seen.add(k)
            keys.append(k)
    return keys

def _build_pdf_lookup_from_df_for_inline(df) -> Dict[str, str]:
    """
    item_key/key -> normalized pdf_path
    """
    out: Dict[str, str] = {}
    if df is None or getattr(df, "empty", True):
        return out
    key_col = "item_key" if "item_key" in df.columns else ("key" if "key" in df.columns else None)
    if not key_col or "pdf_path" not in df.columns:
        return out
    for _, r in df.iterrows():
        k = str(r.get(key_col) or "").strip()
        p = str(r.get("pdf_path") or "").strip()
        if k and p:
            out[k] = os.path.normpath(os.path.expanduser(p))
    return out
def build_apa_lookup_from_html_with_pages(
    html_str: str,
    df,
    pdf_lookup: Dict[str, str],
    page_lookup: dict,
) -> Dict[tuple[str, str], str]:
    """
    Return a mapping: (item_key, direct_quote_text) -> "Author, YYYY, p. N".

    html_str must contain anchors like:
      <a data-key="ITEM_KEY" title="FULL DIRECT QUOTE">…</a>

    page_lookup may be:
      - { item_key: { quote_text_or_cleaned: { "page": int, ... }, ... }, ... }
      - { item_key: int }  (hit counts only; no page info)
    """
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html_str or "", "html.parser")
    cache: Dict[tuple[str, str], str] = {}

    for a in soup.find_all("a"):
        item_key = (a.get("data-key") or "").strip()
        if not item_key:
            continue

        quote_text_raw = (a.get("title") or "").strip()
        pair = (item_key, quote_text_raw)

        if pair in cache:
            continue

        author_year = apa_author_year_from_zotero(item_key, df) or ""
        page_str = ""

        pl_entry = page_lookup.get(item_key) if isinstance(page_lookup, dict) else None

        if isinstance(pl_entry, dict) and quote_text_raw:
            hit = pl_entry.get(quote_text_raw)
            if not hit:
                cleaned = _clean_quote(quote_text_raw)
                if cleaned:
                    hit = pl_entry.get(cleaned)
            if isinstance(hit, dict):
                pg = hit.get("page")
                if isinstance(pg, int):
                    page_str = ", p. " + str(pg)

        if page_str:
            print(
                "[APA PAGE]",
                "item_key=",
                item_key,
                "quote_len=",
                len(quote_text_raw),
                "page_str=",
                page_str,
            )
        else:
            if author_year:
                print(
                    "[APA PAGE MISS]",
                    "item_key=",
                    item_key,
                    "quote_len=",
                    len(quote_text_raw),
                    "pl_type=",
                    type(pl_entry),
                )

        final_txt = (author_year + page_str).strip().strip(",")

        if quote_text_raw:
            cache[(item_key, quote_text_raw)] = final_txt or author_year or ""
        else:
            cache[(item_key, "")] = final_txt or author_year or ""

    return cache


class _InlineCiteOpts(BaseModel):
    text_mode: str = Field(default="bare")
    apa_outside: bool = Field(default=True)
    keep_attrs: List[str] = Field(
        default_factory=lambda: [
            "data-key",
            "title",
            "data-dqid",
            "data-quote_id",
            "data-quote-id",
            "data-quote-text",
        ]
    )
    mirror_dqid_to_quote_id: bool = Field(default=True)


def replace_anchor_datakey_with_apa_page(
    html_str: str,
    citation_lookup: Optional[Dict[Tuple[str, str], str]] = None,
    *,
    text_mode: str = "bare",
    update_href: bool = False,
    url_lookup: Optional[Dict[str, str]] = None,
    apa_outside: bool = True,
) -> str:
    """
    Inline citation post-processor (with page support).

    ###1. read html and resolve APA
    - For each <a data-key="…">, look up (item_key, quote_text) in citation_lookup.
    - citation_lookup values are "Author, YYYY" or "Author, YYYY, p. X".

    ###2. normalise anchor attributes
    - Keep only: data-key, title, data-dqid, data-quote_id, data-quote-id, data-quote-text.
    - title is left as quote text; APA text is emitted outside.
    - data-quote-text preserves the direct quote text.

    ###3. emit APA outside the anchor
    - Insert APA text (with optional parentheses) immediately after the <a>.
    """
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html_str or "", "html.parser")
    opts = _InlineCiteOpts(text_mode=text_mode, apa_outside=apa_outside)

    c_lookup: Dict[Tuple[str, str], str] = citation_lookup or {}

    for a in soup.find_all("a"):
        item_key = (a.get("data-key") or "").strip()
        if not item_key:
            continue

        dqid_val = (
            a.get("data-dqid")
            or a.get("data-quote_id")
            or a.get("data-quote-id")
            or ""
        ).strip()

        if opts.mirror_dqid_to_quote_id and dqid_val:
            a["data-quote_id"] = dqid_val

        quote_text = (a.get("title") or "").strip()

        cite_val = (
            c_lookup.get((item_key, quote_text))
            or c_lookup.get((item_key, ""))
        )

        if cite_val:
            has_page = "p." in cite_val
            print(
                "[APA INSERT]",
                "item_key=",
                item_key,
                "has_page=",
                has_page,
                "cite=",
                cite_val,
            )
            apa_core = cite_val
            apa_text = (
                f"({cite_val})" if opts.text_mode == "paren" else cite_val
            )
        else:
            print(
                "[APA INSERT MISS]",
                "item_key=",
                item_key,
                "quote_len=",
                len(quote_text),
            )
            apa_core = ""
            apa_text = ""

        kept: Dict[str, str] = {}

        for k in opts.keep_attrs:
            if k == "data-key" and item_key:
                kept["data-key"] = item_key
            elif k == "data-dqid" and dqid_val:
                kept["data-dqid"] = dqid_val
            elif k == "data-quote_id" and dqid_val:
                kept["data-quote_id"] = dqid_val
            elif k == "data-quote-id" and dqid_val:
                kept["data-quote-id"] = dqid_val
            elif k == "title" and quote_text:
                kept["title"] = quote_text
            elif k == "data-quote-text" and quote_text:
                kept["data-quote-text"] = quote_text

        a.attrs = kept

        if update_href and url_lookup and item_key in url_lookup:
            a["href"] = url_lookup[item_key]

        a.clear()

        if opts.apa_outside and apa_text:
            a.insert_after(soup.new_string(f" {apa_text}"))

    return str(soup)


def replace_anchor_titles_with_text(
    html: str,
    direct_quote_lookup: Dict[str, Any],
) -> str:
    """
    ###1. scan anchors and recover dqid
    - Prefer data-dqid.
    - Fallback to data-quote-id (hyphen) or data-quote_id (underscore).
    - As a last resort, if title itself is a known dqid, use that.

    ###2. set contract on anchor
    - title           = direct_quote_text
    - data-dqid       = dqid
    - data-quote-text = direct_quote_text
    - inner text left unchanged.
    """
    rx = re.compile(r"<a([^>]*)>(.*?)</a>", flags=re.IGNORECASE | re.DOTALL)

    def _direct_quote_only(src: Any) -> str:
        if isinstance(src, str):
            return src.strip()
        if isinstance(src, dict):
            v = src.get("direct_quote")
            if isinstance(v, str):
                return v.strip()
        return ""

    def _set_or_add_attr(attrs_raw: str, key: str, val: str) -> str:
        safe_val = _html.escape(val, quote=True)
        pat = re.compile(
            rf'(\b{re.escape(key)}\s*=\s*)(?:"[^"]*"|\'[^\']*\')',
            re.IGNORECASE | re.DOTALL,
        )
        if pat.search(attrs_raw):
            return pat.sub(
                lambda m: m.group(1) + '"' + safe_val + '"',
                attrs_raw,
                count=1,
            )
        spacer = "" if attrs_raw.endswith(" ") else " "
        return f'{attrs_raw}{spacer}{key}="{safe_val}"'

    def _sub(match: "re.Match[str]") -> str:
        attrs = match.group(1) or ""
        inner = match.group(2) or ""

        m_dqid = re.search(
            r'\bdata-dqid="([^"]+)"',
            attrs,
            flags=re.IGNORECASE,
        )
        dqid = m_dqid.group(1) if m_dqid else ""

        if dqid == "":
            m_qid_hyphen = re.search(
                r'\bdata-quote-id="([^"]+)"',
                attrs,
                flags=re.IGNORECASE,
            )
            if m_qid_hyphen:
                dqid = m_qid_hyphen.group(1) or ""

        if dqid == "":
            m_qid = re.search(
                r'\bdata-quote_id="([^"]+)"',
                attrs,
                flags=re.IGNORECASE,
            )
            if m_qid:
                dqid = m_qid.group(1) or ""

        if dqid == "":
            m_title = re.search(
                r'\btitle="([^"]+)"',
                attrs,
                flags=re.IGNORECASE,
            )
            if m_title:
                cand = (m_title.group(1) or "").strip()
                if cand in direct_quote_lookup:
                    dqid = cand

        dqid = dqid.strip()
        if dqid == "":
            return match.group(0)

        src = direct_quote_lookup.get(dqid)
        if src is None:
            print("[DQ LOOKUP MISS]", "dqid=", dqid)
            return match.group(0)

        qtext = _direct_quote_only(src)
        if qtext == "":
            print("[DQ EMPTY TEXT]", "dqid=", dqid)
            return match.group(0)

        attrs_out = _set_or_add_attr(attrs, "title", qtext)
        attrs_out = _set_or_add_attr(attrs_out, "data-dqid", dqid)
        attrs_out = _set_or_add_attr(attrs_out, "data-quote-text", qtext)
        return f"<a{attrs_out}>{inner}</a>"

    return rx.sub(_sub, html or "")


from typing import Dict, Tuple, Optional, List
from pydantic import BaseModel, Field
class _InlineCiteOpts(BaseModel):
    text_mode: str = Field(default="bare")
    apa_outside: bool = Field(default=True)
    keep_attrs: List[str] = Field(
        default_factory=lambda: ["data-key", "title", "data-quote_id", "data-quote-text"]
    )
    mirror_dqid_to_quote_id: bool = Field(default=True)



def _build_url_lookup_from_df_for_inline(df) -> Dict[str, str]:
    """
    item_key/key -> url (for href updates)
    """
    out: Dict[str, str] = {}
    if df is None or getattr(df, "empty", True):
        return out
    key_col = "item_key" if "item_key" in df.columns else ("key" if "key" in df.columns else None)
    if not key_col:
        return out
    for _, r in df.iterrows():
        k = str(r.get(key_col) or "").strip()
        url = (r.get("url") or r.get("landing_page") or r.get("doi_url") or "")
        url = str(url).strip()
        if k and url:
            out[k] = url
    return out

from pydantic import BaseModel

class _PageIndexEntry(BaseModel):
    page: int | None = None
    section_title: str | None = None
    section_html: str | None = None
from typing import Dict

class _InlineCiteOpts(BaseModel):
    text_mode: str = Field(default="bare")
    apa_outside: bool = Field(default=True)
    keep_attrs: List[str] = Field(
        default_factory=lambda: [
            "data-key",
            "title",
            "data-dqid",
            "data-quote_id",
            "data-quote-text",
        ]
    )
    mirror_dqid_to_quote_id: bool = Field(default=True)


def replace_anchor_datakey_with_apa_page(
    html_str: str,
    citation_lookup: Optional[Dict[Tuple[str, str], str]] = None,
    *,
    text_mode: str = "bare",
    update_href: bool = False,
    url_lookup: Optional[Dict[str, str]] = None,
    apa_outside: bool = True,
) -> str:
    """
    ###1. resolve APA
    - For each <a data-key="…">, use (item_key, quote_text) against citation_lookup.

    ###2. normalise anchor attributes
    - Keep only: data-key, data-dqid, data-quote_id, title, data-quote-text.
    - title = direct_quote_text
    - data-quote-text = direct_quote_text
    - dqid stored in both data-dqid and data-quote_id when available.

    ###3. emit APA outside the anchor
    - Insert bare or parenthesised APA text immediately after </a>.
    """
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html_str or "", "html.parser")
    opts = _InlineCiteOpts(text_mode=text_mode, apa_outside=apa_outside)

    c_lookup: Dict[Tuple[str, str], str] = citation_lookup or {}

    for a in soup.find_all("a"):
        item_key = (a.get("data-key") or "").strip()
        if item_key == "":
            continue

        dqid_val = (
            a.get("data-dqid")
            or a.get("data-quote_id")
            or ""
        ).strip()

        if opts.mirror_dqid_to_quote_id and dqid_val:
            a["data-quote_id"] = dqid_val

        quote_text = (a.get("title") or "").strip()

        cite_val = (
            c_lookup.get((item_key, quote_text))
            or c_lookup.get((item_key, ""))
        )

        if cite_val:
            apa_text = (
                f"({cite_val})" if opts.text_mode == "paren" else cite_val
            )
        else:
            apa_text = ""

        kept: Dict[str, str] = {}

        for k in opts.keep_attrs:
            if k == "data-key" and item_key:
                kept["data-key"] = item_key
            elif k == "data-dqid" and dqid_val:
                kept["data-dqid"] = dqid_val
            elif k == "data-quote_id" and dqid_val:
                kept["data-quote_id"] = dqid_val
            elif k == "title" and quote_text:
                kept["title"] = quote_text
            elif k == "data-quote-text" and quote_text:
                kept["data-quote-text"] = quote_text

        a.attrs = kept

        if update_href and url_lookup and item_key in url_lookup:
            a["href"] = url_lookup[item_key]

        a.clear()

        if opts.apa_outside and apa_text:
            a.insert_after(soup.new_string(f" {apa_text}"))

    return str(soup)


class _PageIndexEntry(BaseModel):
    page: int | None = None
    section_title: str | None = None
    section_html: str | None = None

from typing import Any, Dict, Tuple, Optional
import pandas as pd
def postprocess_html_with_quotes_and_apa(
    html_raw: str,
    *,
    direct_quote_lookup: Optional[Dict[str, Any]] = None,
    df: Any = None,
) -> str:
    """
    ###1. derive APA (author, year, page) from direct_quote_lookup/df
    ###2. replace <a> inner text with APA string
    ###3. set <a> title to direct_quote from direct_quote_lookup when available
    """
    from bs4 import BeautifulSoup

    if not isinstance(html_raw, str) or not html_raw.strip():
        return html_raw

    soup = BeautifulSoup(html_raw, "html.parser")
    dq_map = direct_quote_lookup or {}

    dq_mode = "none"
    first_val = None
    for _k, _v in dq_map.items():
        first_val = _v
        break

    if isinstance(first_val, dict) and (
        "first_author_last" in first_val
        or "item_key" in first_val
        or "direct_quote" in first_val
        or "direct_quote_clean" in first_val
    ):
        dq_mode = "meta"
    elif isinstance(first_val, str):
        dq_mode = "text"

    dq_meta_apa: Dict[str, Dict[str, Any]] = {}
    dqid_by_clean_text: Dict[str, str] = {}

    def _normalise_id(val: Any) -> str:
        """
        ###1. coerce to str
        ###2. strip whitespace
        ###3. peel simple quote wrappers ('\"id\"', "\"id\"", "'id'")
        """
        s = str(val or "").strip()
        if s.startswith('\\"') and s.endswith('\\"') and len(s) >= 4:
            s = s[2:-2].strip()
        if len(s) >= 2:
            if (s[0] == '"' and s[-1] == '"') or (s[0] == "'" and s[-1] == "'"):
                s = s[1:-1].strip()
        return s

    def _normalise_quote_text(val: Any) -> str:
        """
        ###1. coerce to str
        ###2. lowercase
        ###3. collapse internal whitespace
        """
        s = str(val or "").strip().lower()
        if not s:
            return ""
        parts = s.split()
        return " ".join(parts)

    if dq_mode == "meta":
        for dqid, meta in dq_map.items():
            if not isinstance(meta, dict):
                continue

            dqid_str = _normalise_id(dqid)
            if not dqid_str:
                continue

            author_last = (meta.get("first_author_last") or "").strip()
            year_val = (meta.get("year") or "").strip()
            item_key_meta = (meta.get("item_key") or "").strip()

            raw_page = meta.get("page")
            if isinstance(raw_page, int) and raw_page > 0:
                page_val = raw_page
            else:
                page_val = 0

            dq_text = (
                meta.get("direct_quote")
                or meta.get("direct_quote_clean")
                or ""
            )
            dq_text = str(dq_text).strip()

            apa_core = ""
            if author_last and year_val:
                apa_core = author_last + ", " + year_val
            elif author_last:
                apa_core = author_last
            elif year_val:
                apa_core = year_val

            if not apa_core and df is not None and item_key_meta:
                apa_core = apa_author_year_from_zotero(item_key_meta, df)

            dq_meta_apa[dqid_str] = {
                "apa_core": apa_core.strip(),
                "page": page_val,
                "item_key": item_key_meta,
                "direct_quote": dq_text,
            }

            dq_clean = _normalise_quote_text(
                meta.get("direct_quote_clean")
                or meta.get("direct_quote")
                or ""
            )
            if dq_clean and dq_clean not in dqid_by_clean_text:
                dqid_by_clean_text[dq_clean] = dqid_str

    def _apa_for_anchor(a_tag) -> str:
        original_title = (a_tag.get("title") or "").strip()
        item_key_raw = (a_tag.get("data-key") or "").strip()
        dqid_raw_attr = (
            a_tag.get("data-quote-id")
            or a_tag.get("data-dqid")
            or ""
        )

        item_key = _normalise_id(item_key_raw)
        dqid = _normalise_id(dqid_raw_attr)

        if not dqid and original_title:
            a_tag["data-dqid"] = original_title
            dqid = _normalise_id(original_title)

        title_attr = original_title
        inner_text = (a_tag.text or "").strip()

        apa_core = ""
        page_val = 0
        dq_text_val = ""

        dq_lookup_key = dqid

        if dq_mode == "meta" and dq_lookup_key and dq_lookup_key not in dq_meta_apa:
            quote_source = dq_lookup_key
            if not quote_source and original_title:
                quote_source = original_title
            if not quote_source and inner_text:
                quote_source = inner_text
            quote_norm = _normalise_quote_text(quote_source)
            if quote_norm and quote_norm in dqid_by_clean_text:
                dq_lookup_key = dqid_by_clean_text[quote_norm]

        if dq_mode == "meta" and dq_lookup_key and dq_lookup_key in dq_meta_apa:
            info = dq_meta_apa[dq_lookup_key]
            apa_core = (info.get("apa_core") or "").strip()
            if isinstance(info.get("page"), int) and info.get("page") > 0:
                page_val = info.get("page")
            if not item_key and isinstance(info.get("item_key"), str):
                item_key = _normalise_id(info.get("item_key") or "")
            dq_text_val = (info.get("direct_quote") or "").strip()

        if not apa_core and df is not None and item_key:
            apa_core = apa_author_year_from_zotero(item_key, df).strip()

        if not dq_text_val and dq_mode == "text" and dqid and dqid in dq_map:
            if isinstance(dq_map[dqid], str):
                dq_text_val = dq_map[dqid].strip()

        if dq_text_val:
            a_tag["title"] = dq_text_val

        if not apa_core:
            print(
                "[APA MISS] item_key=",
                repr(item_key),
                "dqid=",
                repr(dqid),
                "title=",
                repr(title_attr),
            )
            return ""

        if page_val > 0:
            apa_text = apa_core + ", p. " + str(page_val)
        else:
            apa_text = apa_core
        apa_text = "(" + apa_text + ")"
        return apa_text

    anchors = soup.find_all("a")
    for a in anchors:
        apa_str = _apa_for_anchor(a)
        if not apa_str:
            continue
        a.clear()
        a.append(soup.new_string(apa_str))

    out_html = str(soup)
    return out_html






def build_apa_lookup_from_html(html_str: str, df:pd.DataFrame) -> dict[str, str]:
    keys = collect_item_keys_from_html(html_str)
    out: dict[str, str] = {}
    for k in keys:
        out[k] = apa_author_year_from_zotero(k, df)
    return out

def apa_author_year_from_zotero(item_key: str, df) -> str:
    """
    Returns 'Surname, YYYY' (no parentheses) using a row in `df` where df['key'] == item_key.
    Prefers 'author_summary' then falls back to 'authors'. Year taken from 'year'.
    df columns expected at least: ['key', 'author_summary', 'authors', 'year'].
    """

    def _is_nan(x):
        return isinstance(x, float) and x != x  # NaN check without pandas import

    def _s(v):
        if v is None:
            return ""
        s = str(v).strip()
        # treat literal 'nan' (from pandas) as empty
        return "" if not s or s.lower() == "nan" else s

    def _surname(name: str) -> str:
        s = (name or "").strip()
        if not s:
            return ""
        if "," in s:
            return s.split(",", 1)[0].strip()
        toks = [t for t in s.split() if t]
        if not toks:
            return ""
        suffixes = {"jr", "jr.", "sr", "sr.", "ii", "iii", "iv", "v"}
        for t in reversed(toks):
            tl = t.lower().strip(".")
            if tl in suffixes or len(tl) == 1:
                continue
            return t
        return toks[-1]

    if not isinstance(item_key, str) or not item_key.strip():
        return ""

    # ---- lookup row by key
    try:
        # Fast path: boolean mask
        row_df = df[df["key"] == item_key]
    except Exception:
        # If df is not a DataFrame-like, bail
        return ""

    if getattr(row_df, "empty", True):
        return ""

    # Take the first match
    row = row_df.iloc[0]

    # ---- author
    author_summary = _s(row.get("author_summary", ""))
    author = ""
    if author_summary:
        # split common joins ("A; B", "A and B")
        parts = re.split(r"\s*;\s*|\s+and\s+", author_summary, maxsplit=1)
        first = (parts[0] if parts else "").strip()
        author = _surname(first)

    if not author:
        authors_val = row.get("authors", "")
        # authors may be list[dict] or string
        if isinstance(authors_val, list) and authors_val:
            a0 = authors_val[0]
            if isinstance(a0, dict):
                last = a0.get("lastName") or a0.get("family") or a0.get("last") or ""
                author = _s(last)
        elif isinstance(authors_val, str):
            first = authors_val.split(";", 1)[0].strip()
            author = _surname(first)

    author = author or "n.a."

    # ---- year
    yr_raw = row.get("year", "")
    yr_str = _s(yr_raw)
    yr = ""
    if yr_str:
        if yr_str.isdigit():
            yr = str(int(yr_str))
        else:
            # try to extract a 4-digit year anywhere in the string
            m = re.search(r"(?<!\d)(\d{4})(?!\d)", yr_str)
            yr = m.group(1) if m else yr_str  # fallback to raw if no 4-digit found

    return f"{author}, {yr}" if yr else author

from pydantic import BaseModel, Field

class _DQPair(BaseModel):
    item_key: str = Field(min_length=1)
    dqid: str = Field(min_length=1)
    text: str = ""

def build_direct_quote_lookup_from_batches(
    batches: List[Tuple[dict, str]]
) -> Dict[str, str]:
    """
    Returns a JSON-safe map using 'item_key||direct_quote_id' keys.
    Also includes a by-item sentinel to enable single-quote fallback.
    Keys produced:
      • "IK||DQID" -> quote text
      • "@by_item::IK" -> "DQID" when exactly one quote exists for that IK
    """
    pairs: List[_DQPair] = []
    for tup in (batches or []):
        batch_obj = tup[0] if isinstance(tup, (list, tuple)) and len(tup) > 0 else {}
        pl = batch_obj.get("payloads") if isinstance(batch_obj, dict) else None
        if isinstance(pl, list):
            for rec in pl:
                if isinstance(rec, dict):
                    ik = str(rec.get("item_key") or "").strip()
                    dqid = str(rec.get("direct_quote_id") or "").strip()
                    if ik and dqid:
                        txt0 = rec.get("direct_quote")
                        txt = txt0 if isinstance(txt0, str) and txt0.strip() else str(rec.get("paraphrase") or "")
                        pairs.append(_DQPair(item_key=ik, dqid=dqid, text=txt))

    out: Dict[str, str] = {}
    by_item: Dict[str, List[str]] = {}
    for p in pairs:
        out[f"{p.item_key}||{p.dqid}"] = p.text
        by_item.setdefault(p.item_key, []).append(p.dqid)

    for ik, dqids in by_item.items():
        if len(dqids) == 1:
            out[f"@by_item::{ik}"] = dqids[0]
    return out

# ------------------------------ text safety ------------------------------

def _sanitize_text(x: Any) -> str | None:
    """
    Return a safe UTF-8 string:
      - coerce to str,
      - strip NULs & problematic control chars (keeps \n \r \t),
      - normalize unicode (NFC),
      - drop unpaired surrogates.
    """
    if x is None:
        return None
    s = str(x)

    # drop NULs and most ASCII controls except \n\r\t
    s = "".join(ch for ch in s if (ch not in "\x00\x01\x02\x03\x04\x05\x06\x07\x08\x0b\x0c\x0e\x0f"
                                   "\x10\x11\x12\x13\x14\x15\x16\x17\x18\x19\x1a\x1b\x1c\x1d\x1e\x1f"))

    # normalize, then encode/decode to strip invalid surrogates
    s = unicodedata.normalize("NFC", s)
    s = s.encode("utf-8", "ignore").decode("utf-8", "ignore")
    return s.strip()

def _clean_scalar(v: Any) -> Any:
    """Keep lists/dicts as-is, clean scalars with _sanitize_text; pass through None."""
    if v is None:
        return None
    if isinstance(v, (list, dict)):
        return v
    return _sanitize_text(v)

# --------------------------- metadata helpers ----------------------------

def _first_author_from_meta(md: Dict[str, Any]) -> str | None:
    """
    Best-effort 'Last, First' (or just 'Last').
    NO title fallback (returns None if unknown).
    """
    # structured lists first
    for key in ("authors", "authors_list", "creator", "creators"):
        val = md.get(key)
        if isinstance(val, list) and val:
            a0 = val[0]
            if isinstance(a0, dict):
                last = _sanitize_text(a0.get("lastName") or a0.get("family"))
                first = _sanitize_text(a0.get("firstName") or a0.get("given"))
                if last and first: return f"{last}, {first}"
                if last: return last
                if first: return first
            elif isinstance(a0, str) and a0.strip():
                # string like "Lastname, First; Other"
                head = a0.split(";", 1)[0].strip()
                return head
    # summary strings
    for key in ("author_summary", "creator_summary"):
        s = _sanitize_text(md.get(key))
        if s:
            # take the first block; if "Last, First" keep "Last"
            first_block = s.split(";", 1)[0].strip()
            if "," in first_block:
                return first_block.split(",", 1)[0].strip()
            return first_block
    return None

def _build_meta_index_from_df(df: Optional[pd.DataFrame]) -> Dict[str, Dict[str, Any]]:
    """
    Build per-key metadata (creator_summary, author_summary, first_author_last, year, title, source, url, …)
    """
    idx: Dict[str, Dict[str, Any]] = {}
    if df is None or not isinstance(df, pd.DataFrame) or df.empty:
        return idx

    for _, r in df.iterrows():
        key = _sanitize_text(r.get("key"))
        if not key:
            continue

        md: Dict[str, Any] = {}
        # prefer creator_summary key in the OUTPUT; fall back to author_summary for the VALUE
        creator_summary = _sanitize_text(r.get("creator_summary"))
        author_summary  = _sanitize_text(r.get("author_summary"))
        if creator_summary:
            md["creator_summary"] = creator_summary
        elif author_summary:
            md["creator_summary"] = author_summary  # value fallback, key is creator_summary

        # keep raw author structures/strings when present
        for col in ("authors", "authors_list", "creator", "creators"):
            val = r.get(col)
            if isinstance(val, (list, dict)):
                md[col] = val
            elif isinstance(val, str) and val.strip():
                md[col] = _sanitize_text(val)

        title = _sanitize_text(r.get("title"))
        if title: md["title"] = title

        year = r.get("year")
        if isinstance(year, (int, float)) and pd.notna(year):
            y = int(year) if float(year).is_integer() else year
            md["year"] = str(y)
        elif isinstance(year, str) and year.strip():
            md["year"] = _sanitize_text(year)

        source = r.get("source") if pd.notna(r.get("source")) else r.get("publicationTitle")
        source = _sanitize_text(source)
        if source: md["source"] = source

        url = _sanitize_text(r.get("url"))
        if url: md["url"] = url

        # compute first_author_last without title fallback
        md["first_author_last"] = _first_author_from_meta(md)

        idx[key] = md
    return idx

# ------------------------------ main writer ------------------------------



# Optional accelerators
try:
    import orjson
except Exception:
    orjson = None

try:
    import zstandard as zstd
except Exception:
    zstd = None


# ------------------------- metadata helpers -------------------------

def _clean(v: Any):
    try:
        import math
        if isinstance(v, float) and math.isnan(v):
            return None
    except Exception:
        pass
    return None if v is None else v

def _clean_str(v: Any) -> str:
    v = _clean(v)
    if isinstance(v, (int, float)):
        try:
            if float(v).is_integer():
                return str(int(v))
        except Exception:
            return str(v)
        return str(v)
    return (v or "").strip() if isinstance(v, str) else ""

def _first_author_from_meta(md: Dict[str, Any]) -> str:
    """
    Return a stable 'FirstAuthor' label from a df-derived metadata record.
    Looks at structured authors first, then summary strings; finally title.
    """
    for key in ("authors", "authors_list", "creator", "creators"):
        val = md.get(key)
        if isinstance(val, list) and val:
            a0 = val[0]
            if isinstance(a0, dict):
                last = _clean_str(a0.get("lastName") or a0.get("family"))
                first = _clean_str(a0.get("firstName") or a0.get("given"))
                if last and first: return f"{last}, {first}"
                if last: return last
                if first: return first
            elif isinstance(a0, str) and a0.strip():
                return a0.split(";")[0].strip()
    for key in ("author_summary", "creator_summary"):
        s = _clean_str(md.get(key))
        if s:
            first_block = s.split(";")[0].strip()
            return first_block.split(",")[0].strip() if "," in first_block else first_block
    return _clean_str(md.get("title")) or ""

def build_meta_index(df: Optional[pd.DataFrame]) -> Dict[str, Dict[str, Any]]:
    """
    Build per-key metadata map from df so we can resolve authors, year, source, url, etc.
    - Fills 'author_summary' (prefers author_summary, else creator_summary).
    - Keeps structured author fields if present (not required for output).
    """
    idx: Dict[str, Dict[str, Any]] = {}
    if df is None or not isinstance(df, pd.DataFrame) or df.empty:
        return idx

    for _, r in df.iterrows():
        key = _clean_str(r.get("key"))
        if not key:
            continue

        md: Dict[str, Any] = {}

        # Author summaries (prefer author_summary; fallback to creator_summary — stored AS author_summary)
        a_sum = _clean_str(r.get("author_summary"))
        c_sum = _clean_str(r.get("creator_summary"))
        if a_sum:
            md["author_summary"] = a_sum
        elif c_sum:
            md["author_summary"] = c_sum  # <- normalize creator_summary to author_summary

        # Preserve raw author fields in case you want them later (optional)
        for col in ("authors", "authors_list", "creator", "creators"):
            val = _clean(r.get(col))
            if isinstance(val, (list, dict)):
                md[col] = val
            elif isinstance(val, str) and val.strip():
                md[col] = val.strip()

        # Title
        t = _clean_str(r.get("title"))
        if t:
            md["title"] = t

        # Year
        y = r.get("year")
        ys = _clean_str(y)
        md["year"] = ys if ys else None

        # Source
        src = _clean_str(r.get("source")) or _clean_str(r.get("publicationTitle"))
        if src:
            md["source"] = src

        # URL
        url = _clean_str(r.get("url"))
        if url:
            md["url"] = url

        # Derived first author (last name, First if possible)
        md["first_author_last"] = _first_author_from_meta(md) or None

        # Final cleanup: drop Nones
        md = {k: v for k, v in md.items() if v not in (None, "", [])}
        idx[key] = md

    return idx


# ------------------------- flattening -------------------------



# ------------------------- robust writers -------------------------

def _atomic_write_bytes(path: str, data: bytes) -> None:
    """
    Write bytes atomically: temp file + fsync + rename, to avoid truncated JSON.
    """
    d = os.path.dirname(path) or "."
    os.makedirs(d, exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "wb") as f:
        f.write(data)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)

def resolve_extract_themes_results_path(
    dir_base: str | None,
    collection_name: str | None,
) -> tuple[str, str]:
    """
    Resolve the output directory and JSON path in a Windows-safe way.
    We slug BOTH the directory name and the file stem. For backward compatibility,
    also check an existing unslugged directory if present.
    """


    if not collection_name or not str(collection_name).strip():
        raise ValueError("collection_name is required to resolve the results path.")

    def _slug_name(s: str) -> str:
        # replace all non-safe chars (including colon) with underscore
        return re.sub(r"[^A-Za-z0-9._-]+", "_", (s or "themes")).strip("_")

    base = dir_base or os.getcwd()
    safe_dir = _slug_name(collection_name)

    # preferred path (slugged directory)
    out_dir_pref = os.path.join(base, safe_dir)
    stem = _slug_name(collection_name)
    json_pref = os.path.join(out_dir_pref, f"{stem}_results_by_item.json")

    # backward-compat candidate: unslugged directory (might exist from older runs)
    out_dir_legacy = os.path.join(base, str(collection_name))
    json_legacy = os.path.join(out_dir_legacy, f"{stem}_results_by_item.json")

    # choose path: prefer an existing JSON wherever it lives; else create slugged dir
    if os.path.isfile(json_pref):
        out_dir = out_dir_pref
        json_path = json_pref
    elif os.path.isfile(json_legacy):
        out_dir = out_dir_legacy
        json_path = json_legacy
    else:
        os.makedirs(out_dir_pref, exist_ok=True)
        out_dir = out_dir_pref
        json_path = json_pref
        if not os.path.isfile(json_path):
            raise FileNotFoundError(f"Expected results_by_item JSON not found: {json_path}")

    # ensure directory exists for downstream writes
    os.makedirs(out_dir, exist_ok=True)
    return out_dir, json_path

def _expand_paragraph_tag_rows(df_par):
    records = []
    if df_par is None or df_par.empty:
        return records
    for _, row in df_par.iterrows():
        para_html = row.get("paragraph")
        tags = row.get("tags") or []
        meta = row.get("meta") or {}
        rq = (meta or {}).get("rq") or "(unspecified RQ)"
        if not tags:
            records.append({"rq": rq, "tag": "(untagged)", "paragraph": para_html, "meta": meta})
        else:
            for t in tags:
                t_str = str(t or "").strip()
                if not t_str:
                    t_str = "(untagged)"
                records.append({"rq": rq, "tag": t_str, "paragraph": para_html, "meta": meta})
    return records

def _cluster_tags_per_rq(tag_list):
    """
    Input: tag_list = list[str]
    Output: dict {cluster_id: {"members":[...], "label":<display>}}
    """

    texts = [str(t or "") for t in tag_list]
    buckets = _cluster_texts_with_embeddings(texts)
    freq = Counter(texts)
    clusters = {}
    for root, idxs in buckets.items():
        members = [texts[i] for i in idxs]
        label = _choose_display(Counter({m: freq[m] for m in members})) or members[0]
        clusters[str(root)] = {"members": sorted(set(members)), "label": label}
    return clusters



def _make_pyr_l2_prompt(n_items: int) -> str:
    """
    L2 prompt: inputs are THEMATIC PARAGRAPHS (HTML) with <p data-tags="..."> and existing anchors.
    Each input object = { meta: {rq, gold_theme, potential_theme, evidence_type, cluster_tag, source_custom_ids, ...},
                         section_html: "<p>..anchors..</p>..." }

    Task: write ONE cohesive section that reuses the anchors already present in section_html.
    Title must be derived from the inputs (majority rq, dominant cluster_tag, evidence_type or 'mixed').
    Coverage, hygiene, and ledger rules mirror L1 but adapted to paragraph inputs.
    """
    return (
        "You are drafting a consolidated section from clustered PYR-L1 thematic paragraphs.\n\n"
        "INPUT FORMAT\n"
        "You will receive a JSON array with N items (N varies). Each item contains:\n"
        "• meta: an object with keys {rq, gold_theme, potential_theme, evidence_type, cluster_tag, source_custom_ids, custom_id?}.\n"
        "• section_html: one or more <p> elements. Each <p> has data-tags and includes existing evidence anchors of the exact form:\n"
        "    <a href=\"KEY\" data-key=\"item_key\" title=\"direct_quote_id\">item_key</a>\n\n"
        "OBJECTIVE\n"
        f"Summarise and integrate the {n_items} input paragraphs into a single, coherent HTML section that:\n"
        "• preserves distinct insights while removing repetition,\n"
        "• surfaces convergences/divergences across tags and evidence types,\n"
        "• reuses the EXISTING anchors from the inputs (no new keys),\n"
        "• ends with a 2–3 sentence global takeaway.\n\n"
        "TITLE DERIVATION\n"
        "• Compute the majority rq across meta.rq. Compute the dominant label from meta.cluster_tag or meta.potential_theme.\n"
        "• Compute evidence_type as the majority value; use 'mixed' if no majority.\n"
        "• Begin with an HTML section title using this exact shape:\n"
        "  <h3 id=\"section-title\">[provocative but academic title reflecting the whole section]</h3>\n\n"
        "COVERAGE RULES (exhaustive)\n"
        "• Every INPUT ITEM must contribute content at least once. No exceptions. Cite via the anchors already present in its paragraph(s).\n"
        "• Prefer grouping by shared tags/potential_theme; when useful, show convergence or disagreement in the same paragraph.\n"
        "• If any input paragraphs remain hard to place, add a final paragraph titled \"Residual coverage\" citing them with their existing anchors.\n\n"
        "CITATION HYGIENE (mandatory)\n"
        "• At least one anchor per paragraph; anchor every non-obvious claim immediately after the supporting sentence.\n"
        "• Reuse anchors as-is from inputs. Do not invent keys, do not modify href/data-key/title values.\n"
        "• When multiple sources support the same sentence, include multiple existing anchors in one parenthetical set separated by semicolons.\n"
        "• Do not duplicate the same (item_key, direct_quote_id) within a single sentence.\n\n"
        "DIVERSITY & ECONOMY\n"
        "• Aim for ≥2 DISTINCT item_keys per thematic paragraph when available.\n"
        "• Avoid citing the same item_key in consecutive sentences unless necessary; vary sources when evidence permits.\n\n"
        "OUTPUT (strictly raw HTML — no Markdown, no lists)\n"
        "• Start with exactly one title element as specified above.\n"
        "• Then write N thematic <p> paragraphs. Each paragraph MUST:\n"
        "  – be a single <p> element\n"
        "  – include a data-tags attribute (1–3 concise tags; reuse or compose from input tags)\n"
        "  – include ≥1 correctly formed, pre-existing anchor\n"
        "  Example shape:\n"
        "  <p id=\"p1\" data-tags=\"methods;scope\">Topic sentence. Evidence-led exposition … (" 
        "<a href=\"KEY\" data-key=\"item_key_A\" title=\"dq_1\"></a>; "
        "<a href=\"KEY2\" data-key=\"item_key_B\" title=\"dq_2\"></a>)</p>\n"
        "• After thematic paragraphs, add a conclusive paragraph (2–3 sentences) with EXACT id:\n"
        "  <p id=\"conslusion\">Synthesis across paragraphs; strongest regularities, salient disagreements, implications.</p>\n"
        "• If any inputs were not integrated thematically, append a residuals paragraph with EXACT id (note the space at the end):\n"
        "  <p id=\"Residual \">Residual coverage: brief reason these items do not fit; still cite them with existing anchors.</p>\n"
        "• Finally, append TWO HTML comments for traceability:\n"
        "  <!-- inputs used=[comma-separated meta.source_custom_ids actually cited] -->\n"
        "  <!-- coverage used=[comma-separated item_keys cited] unused=[comma-separated item_keys from INPUTS not cited] -->\n\n"
        "QUALITY CHECK (fix before returning)\n"
        "• Every paragraph has ≥1 anchor\n"
        "• Each <p> has data-tags with 1–3 tags; tags are concise and informative.\n"
        "• No invented keys; all anchors come from the provided section_html.\n"
        "• Include exactly one <h3 id=\"section-title\">, one <p id=\"conslusion\">, and optional <p id=\"Residual \"> when needed.\n"
        "• Ensure the coverage ledger matches anchors actually present in your output.\n"
    )

def _extract_html(raw):
        if isinstance(raw, str):
            return raw
        if isinstance(raw, dict):
            for k in ("html", "result", "response", "payload", "output"):
                v = raw.get(k)
                if isinstance(v, str) and v.strip():
                    return v
        if isinstance(raw, (list, tuple)) and raw:
            first = raw[0]
            if isinstance(first, str) and first.strip():
                return first
            if isinstance(first, dict):
                for k in ("html", "result", "response", "payload", "output"):
                    v = first.get(k)
                    if isinstance(v, str) and v.strip():
                        return v
        return str(raw) if raw is not None else ""

class ClusterInfo(TypedDict):
    label: str
    members: List[str]


class ParagraphRecord(BaseModel):
    tag: str
    rq: str | None = Field(default=None)
    paragraph: str | None = Field(default=None)
    meta: Dict[str, Any] | None = Field(default=None)


class MetaOut(BaseModel):
    rq: str | None = Field(default=None)
    gold_theme: str | None = Field(default=None)
    potential_theme: str | None = Field(default=None)
    evidence_type: str | None = Field(default=None)
    cluster_tag: str | None = Field(default=None)
    cluster_members: List[str] | None = Field(default=None)
    source_custom_ids: List[str] | None = Field(default=None)


def _build_r2_jobs_from_tag_clusters(
    df_par: Any, batch_size: int
) -> Tuple[List[Tuple[Dict[str, Any], str]], Dict[str, Any]]:
    """
    Returns:
      jobs2: List[(batch_obj, prompt_str)]
      tag_inventory: dict for diagnostics

    Contract for helpers (assumed available in module scope):
      - _expand_paragraph_tag_rows(df_par) -> Iterable[Mapping[str, Any]]
        Each record should provide keys: 'rq', 'tag', 'paragraph', 'meta'
      - _cluster_tags_per_rq(tags: List[str]) -> Dict[str, ClusterInfo]
      - _make_pyr_l2_prompt(n: int) -> str
    """

    # 1) Normalise and validate input rows to avoid `.get` on non-mapping objects
    expanded_raw: Iterable[Any] = _expand_paragraph_tag_rows(df_par)
    norm: List[ParagraphRecord] = []
    for rec in expanded_raw:
        if not isinstance(rec, Mapping):
            continue
        tag_val = rec.get("tag")
        if not isinstance(tag_val, str):
            continue
        rq_val = rec.get("rq")
        para_val = rec.get("paragraph")
        meta_val = rec.get("meta") if isinstance(rec.get("meta"), Mapping) else None
        norm.append(
            ParagraphRecord(
                tag=tag_val,
                rq=rq_val if isinstance(rq_val, str) else None,
                paragraph=para_val if isinstance(para_val, str) else None,
                meta=dict(meta_val) if isinstance(meta_val, Mapping) else None,
            )
        )

    # 2) Group by RQ
    by_rq: Dict[str, List[ParagraphRecord]] = defaultdict(list)
    for rec in norm:
        by_rq[rec.rq or "<?>"].append(rec)

    jobs2_local: List[Tuple[Dict[str, Any], str]] = []
    inventory: Dict[str, Any] = {"by_rq": {}, "stats": {"total_rq": 0, "total_clusters": 0, "total_items": 0}}

    # 3) For each RQ, cluster by tags then assemble batches
    for rq, recs in by_rq.items():
        tag_counts = Counter([r.tag for r in recs])
        clusters: Dict[str, ClusterInfo] = _cluster_tags_per_rq(list(tag_counts.keys()))

        # Prepare container per-cluster
        cluster_records: Dict[str, List[ParagraphRecord]] = {cid: [] for cid in clusters.keys()}
        for r in recs:
            for cid, cinfo in clusters.items():
                if r.tag in cinfo["members"]:
                    cluster_records[cid].append(r)
                    break

        cluster_items: List[Dict[str, Any]] = []
        cluster_inventory: List[Dict[str, Any]] = []

        for cid, items in cluster_records.items():
            if not items:
                continue

            label = clusters[cid]["label"]
            members = clusters[cid]["members"]

            # Concatenate paragraphs safely
            html_parts: List[str] = []
            for it in items:
                if isinstance(it.paragraph, str) and it.paragraph:
                    html_parts.append(it.paragraph)
            html_joined = "".join(html_parts)

            # Extract meta fields with guards (avoid `.get` on non-dicts)
            src_ids: List[str] = []
            golds: List[str] = []
            etypes: List[str] = []
            for it in items:
                m = it.meta or {}
                v_id = m.get("custom_id")
                if isinstance(v_id, str) and v_id:
                    src_ids.append(v_id)
                v_gold = m.get("gold_theme")
                if isinstance(v_gold, str) and v_gold:
                    golds.append(v_gold)
                v_et = m.get("evidence_type")
                if isinstance(v_et, str) and v_et:
                    etypes.append(v_et)

            src_ids = sorted(set(src_ids))
            golds = sorted(set(golds))
            etypes = sorted(set(etypes))

            meta_out = MetaOut(
                rq=rq,
                gold_theme="mixed" if len(golds) > 1 else (golds[0] if golds else None),
                potential_theme=label,
                evidence_type="mixed" if len(etypes) > 1 else (etypes[0] if etypes else "mixed"),
                cluster_tag=label,
                cluster_members=members,
                source_custom_ids=src_ids,
            ).model_dump(exclude_none=True)

            payload_obj: Dict[str, Any] = {
                "meta": meta_out,
                "section_html": html_joined,
            }
            cluster_items.append(payload_obj)

            cluster_inventory.append(
                {
                    "cluster_tag": label,
                    "members": members,
                    "paragraphs": len(items),
                    "sources": len(src_ids),
                }
            )

        def _chunk_list(lst: List[Dict[str, Any]], n: int) -> List[List[Dict[str, Any]]]:
            step = n if n > 0 else 1
            return [lst[i : i + step] for i in range(0, len(lst), step)]

        chunks = _chunk_list(cluster_items, batch_size)
        for ch in chunks:
            l2_prompt: str = _make_pyr_l2_prompt(len(ch))
            l2_batch: Dict[str, Any] = {"size": len(ch), "payloads": ch}
            jobs2_local.append((l2_batch, l2_prompt))

        inventory["by_rq"][rq] = {
            "n_paragraphs": len(recs),
            "n_unique_tags": len(tag_counts),
            "tag_counts": dict(tag_counts),
            "n_clusters": len([c for c in cluster_inventory if int(c.get("paragraphs", 0)) > 0]),
            "clusters": cluster_inventory,
        }

    # 4) Totals
    inventory["stats"]["total_rq"] = len(inventory["by_rq"])
    inventory["stats"]["total_clusters"] = sum(int(v.get("n_clusters", 0)) for v in inventory["by_rq"].values())
    inventory["stats"]["total_items"] = sum(len(v.get("tag_counts", {})) for v in inventory["by_rq"].values())

    return jobs2_local, inventory


# compiled once, reused
_RQ_CHUNK_RE = re.compile(r"""
    (                                   # === things to remove ===
      # (a) any (...) that contains RQ/RQs
      \([^()]*\bRQs?\b[^()]*\)
      |
      # (b) any [...] that contains RQ/RQs
      \[[^\[\]]*\bRQs?\b[^\[\]]*\]
      |
      # (c) sequences like: RQ2, RQ 3)   RQ 3; RQ 2)   RQs 0, 1, and 2
      \b
      (?:
         RQs?\s*                         # optional leading 'RQ'/'RQs'
      )?
      RQ?\s*\d+                          # first number (with optional 'RQ')
      (?:\s*(?:,|;|\band\b|&|-|–)\s*     # list separators
          (?:RQ\s*)?\d+                  # next number, optional 'RQ'
      )+                                  # 2+ items in the sequence
      \)?                                 # optional trailing ')'
    )
""", re.IGNORECASE | re.VERBOSE)

_EMPTY_PARENS_RE = re.compile(r"\(\s*\)|\[\s*\]|\{\s*\}")

def strip_rq_refs(text: str) -> str:
    if not isinstance(text, str) or not text.strip():
        return text
    # 1) remove RQ chunks
    s = _RQ_CHUNK_RE.sub("", text)
    # 2) remove now-empty brackets
    s = _EMPTY_PARENS_RE.sub("", s)
    # 3) tidy whitespace and spaces before punctuation
    s = re.sub(r"\s{2,}", " ", s)
    s = re.sub(r"\s+([,;:.!?])", r"\1", s)
    return s.strip()

def _infer_common_from_payloads(payloads: list[dict], key: str) -> str | None:
    """
    Look across payload items and return a single consistent value for `key`.
    Accepts both direct keys and nested `meta` keys.
    If multiple different values exist, return 'mixed'.
    If none found, return None.
    """
    vals = []
    for it in (payloads or []):
        if not isinstance(it, dict):
            continue
        meta = it.get("meta") or {}
        v = (it.get(key) or meta.get(key) or "").strip()
        if v:
            vals.append(v)
    if not vals:
        return None
    uniq = sorted(set(vals))
    return uniq[0] if len(uniq) == 1 else "mixed"


def rq_batching(df_par, batch_size: int):
    """
    High-level wrapper to produce Round-2 batches from paragraph tags.
    Returns (jobs2, tag_inventory).
    """
    return _build_r2_jobs_from_tag_clusters(df_par=df_par, batch_size=batch_size)




from pydantic import BaseModel


class _ReturnSchema(BaseModel):
    collection_name: str
    out_dir: str
    manifest_path: Optional[str]
    num_batches: int
    submitted: bool
    read_ok: bool
    outputs: List[Dict[str, Any]]
    round1_sections: List[Dict[str, Any]]
    num_batches_round2: int
    custom_ids_round2: List[str]
    outputs_round2: List[Dict[str, Any]]
    export_paths: Dict[str, Any]


from pydantic import BaseModel


class BatchingArtifacts(BaseModel):
    out_dir: str
    manifest_path: Optional[str]
    groups: Dict[str, Any]
    planned_files: List[Tuple[str, List[Tuple[Dict[str, Any], str]]]]
    all_jobs_flat: List[Tuple[Dict[str, Any], str]]
    direct_quote_lookup: Dict[str, str]
    quote_hits: Dict[str, Any]


class RoundResults(BaseModel):
    outputs_round1: List[Dict[str, Any]]
    round1_sections_merged: List[Dict[str, Any]]
    outputs_round2: List[Dict[str, Any]]
    custom_ids_round2: List[str]
    final_merged_html: str
    export_paths: Dict[str, Any]
    num_batches_round2: int
    outputs_round3 : List[Dict[str, Any]]
    custom_ids_round3 :  List[str]
    round3_sections_merged :str
    num_batches_round3 : int
    round3_sections_merged : str



def batching_claims(
    collection_name: str,
    top_n_per_score: Optional[int],
    score_key_format: str,
    dir_base: str,
    df: Any,
    manifest_path: Optional[str],
    use_round1_cache: bool,
) -> BatchingArtifacts:



    MAX_BATCH_BYTES: int = 209_715_200
    MAX_INPUT_BYTES: int = 10_000_000
    L1_BATCH_SIZE: int = 20
    L1_OVERLAP: int = 5

    def _slug_name(s: str) -> str:
        return re.sub(r"[^A-Za-z0-9._-]+", "_", (s or "themes")).strip("_")

    def _slug_for(s: str, n: int = 80) -> str:
        s2 = re.sub(r"[^A-Za-z0-9._-]+", "_", (s or "x"))
        s2 = re.sub(r"_+", "_", s2).strip("_")
        return s2[:n] if len(s2) > n else s2

    def _ensure_dqid(item: dict) -> dict:
        if not isinstance(item, dict):
            return {}
        if isinstance(item.get("direct_quote_id"), str) and item["direct_quote_id"].strip():
            return item
        anchor = (item.get("direct_quote") or item.get("paraphrase") or item.get("researcher_comment") or "").strip()
        base = f"{item.get('item_key', '')}||{anchor}"
        item["direct_quote_id"] = hashlib.md5(base.encode("utf-8")).hexdigest()[:10]
        return item

    def _strip_scores_and_count(items: List[dict]) -> Tuple[List[dict], Dict[str, int]]:
        counts: Dict[str, int] = {}
        cleaned: List[dict] = []
        for it in (items or []):
            if not isinstance(it, dict):
                continue
            sb = it.get("score_bucket")
            if isinstance(sb, (int, str)) and str(sb).strip():
                k = str(sb).strip()
                counts[k] = counts.get(k, 0) + 1
            it2 = {k: v for k, v in it.items() if k not in ("relevance_score", "score_bucket")}
            _ensure_dqid(it2)
            cleaned.append(it2)
        return cleaned, counts

    requested_slug = _slug_name(collection_name)
    normalized_dir_base = os.path.abspath(dir_base)
    base_tail = os.path.basename(normalized_dir_base).lower()
    is_already_scoped = bool(requested_slug) and base_tail == requested_slug.lower()
    out_dir: str = normalized_dir_base if is_already_scoped else os.path.join(dir_base, requested_slug)
    os.makedirs(out_dir, exist_ok=True)

    if not manifest_path:
        eco_root = os.path.join(os.path.dirname(dir_base), "evidence_coding_outputs")
        eco_coll_dir = os.path.join(eco_root, _slug_name(collection_name))
        guess_manifest = os.path.join(eco_coll_dir, "manifest.json")
        if os.path.isfile(guess_manifest):
            manifest_path = guess_manifest
        else:
            local_manifest = os.path.join(out_dir, "manifest.json")
            manifest_path = local_manifest if os.path.isfile(local_manifest) else None

    if manifest_path and os.path.isfile(manifest_path):
        print(f"[process_rq_theme_claims] Using manifest → {manifest_path}")
        groups = regroup_all_rqs_from_manifest(
            manifest_path=manifest_path,
            top_n_per_score=top_n_per_score,
            score_key_format=score_key_format,
        )
    else:
        print("[process_rq_theme_claims] WARN: manifest.json not found; using empty groups")
        groups = {}

    def _count_records_for_rq(rq_map: dict) -> int:
        total = 0
        for _gold, ptmap in (rq_map or {}).items():
            for _pt, etmap in (ptmap or {}).items():
                for _et, sbmap in (etmap or {}).items():
                    for _sb, lst in (sbmap or {}).items():
                        total += len(lst or [])
        return total

    print("groups keys:", list(groups.keys()))
    for _rq, _rq_map in (groups or {}).items():
        print(f"[DIAG] RQ='{str(_rq)[:60]}…' total_records={_count_records_for_rq(_rq_map)}")

    jobs_all = batching_rq_themes_with_routes(
        groups,
        batch_size=L1_BATCH_SIZE,
        overlap=L1_OVERLAP,
        score="fallback",
    )

    def _dominant_label(values: List[str]) -> Optional[str]:
        vals = [str(v).strip() for v in values if isinstance(v, str) and v.strip()]
        if not vals:
            return None
        from collections import Counter as _Counter
        c = _Counter(vals)
        lab, cnt = c.most_common(1)[0]
        total = sum(c.values())
        return lab if cnt > total / 2 or len(c) == 1 else "mixed"

    def _relabel_theme_from_payload_gold(jobs: List[Tuple[Dict[str, Any], str]]) -> List[Tuple[Dict[str, Any], str]]:
        out_jobs: List[Tuple[Dict[str, Any], str]] = []
        for job, prompt in jobs:
            payloads = job.get("payloads", []) or []
            golds: List[str] = []
            pthemes: List[str] = []
            etypes: List[str] = []
            for it in payloads:
                if not isinstance(it, dict):
                    continue
                meta = it.get("meta") or {}
                golds.append((it.get("gold_theme") or meta.get("gold_theme") or "").strip())
                pthemes.append((it.get("potential_theme") or meta.get("potential_theme") or "").strip())
                etypes.append((it.get("evidence_type") or meta.get("evidence_type") or "").strip())
            new_job = dict(job)
            g = _dominant_label(golds)
            p = _dominant_label(pthemes)
            e = _dominant_label(etypes)
            if g:
                new_job["theme"] = g
            if p:
                new_job["potential_theme"] = p
            if e:
                new_job["evidence_type"] = e
            out_jobs.append((new_job, prompt))
        return out_jobs

    jobs_all = _relabel_theme_from_payload_gold(jobs_all)

    def _estimate_job_line_bytes(job: Dict[str, Any], prompt: str) -> int:
        payloads = job.get("payloads", []) or []
        cleaned, _ = _strip_scores_and_count(payloads)
        req_input = "PROMPT:\n" + str(prompt) + "\n\nPAYLOAD(JSON):\n" + json.dumps(cleaned, ensure_ascii=False, separators=(",", ":"))
        return len(req_input.encode("utf-8"))

    def _estimate_file_bytes(job_prompts: List[Tuple[Dict[str, Any], str]]) -> int:
        total_b = 0
        for job, prompt in job_prompts:
            total_b += _estimate_job_line_bytes(job, prompt)
            total_b += 1
        return total_b

    def _chunk_single_job_if_needed(job: Dict[str, Any], prompt: str) -> List[Tuple[Dict[str, Any], str]]:
        size = _estimate_job_line_bytes(job, prompt)
        if size <= MAX_INPUT_BYTES:
            return [(job, prompt)]
        payloads = list(job.get("payloads", []) or [])
        chunks: List[Tuple[Dict[str, Any], str]] = []
        current: List[Dict[str, Any]] = []
        for p in payloads:
            candidate = current + [p]
            tmp_job = dict(job)
            tmp_job["payloads"] = candidate
            if current and _estimate_job_line_bytes(tmp_job, prompt) > MAX_INPUT_BYTES:
                j2 = dict(job)
                j2["payloads"] = current
                chunks.append((j2, prompt))
                current = [p]
            else:
                current = candidate
        if current:
            j2 = dict(job)
            j2["payloads"] = current
            chunks.append((j2, prompt))
        return chunks

    def _enforce_input_cap(jobs_for_group: List[Tuple[Dict[str, Any], str]]) -> List[Tuple[Dict[str, Any], str]]:
        out_list: List[Tuple[Dict[str, Any], str]] = []
        for job, prompt in jobs_for_group:
            out_list.extend(_chunk_single_job_if_needed(job, prompt))
        return out_list

    def _group_jobs_by_gold(jobs_for_rq: List[Tuple[Dict[str, Any], str]]) -> Dict[str, List[Tuple[Dict[str, Any], str]]]:
        out_map: Dict[str, List[Tuple[Dict[str, Any], str]]] = {}
        for j in jobs_for_rq:
            job, _ = j
            g = job.get("theme") or "( without gold)"
            out_map.setdefault(g, []).append(j)
        return out_map

    def _group_jobs_by_route(jobs_for_gold: List[Tuple[Dict[str, Any], str]]) -> Dict[str, List[Tuple[Dict[str, Any], str]]]:
        out_map: Dict[str, List[Tuple[Dict[str, Any], str]]] = {}
        for j in jobs_for_gold:
            job, _ = j
            r = job.get("route") or "fallback"
            out_map.setdefault(r, []).append(j)
        return out_map

    rq_to_jobs: Dict[str, List[Tuple[Dict[str, Any], str]]] = {}
    for j in jobs_all:
        job, prompt = j
        rq_key = (job or {}).get("rq_question") or "(unknown RQ)"
        rq_to_jobs.setdefault(rq_key, []).append((job, prompt))

    planned_files: List[Tuple[str, List[Tuple[Dict[str, Any], str]]]] = []
    for rq_label, jobs_for_rq in rq_to_jobs.items():
        jobs_for_rq2 = _enforce_input_cap(jobs_for_rq)
        bytes_rq = _estimate_file_bytes(jobs_for_rq2)
        if bytes_rq <= MAX_BATCH_BYTES:
            planned_files.append((f"{_slug_for(rq_label, 80)}", jobs_for_rq2))
        else:
            by_gold = _group_jobs_by_gold(jobs_for_rq2)
            for gold_name, gold_jobs in by_gold.items():
                gold_jobs2 = _enforce_input_cap(gold_jobs)
                bytes_gold = _estimate_file_bytes(gold_jobs2)
                if bytes_gold <= MAX_BATCH_BYTES:
                    suffix = f"{_slug_for(rq_label, 56)}__{_slug_for(gold_name, 20)}"
                    planned_files.append((suffix, gold_jobs2))
                else:
                    by_route = _group_jobs_by_route(gold_jobs2)
                    for route_name, route_jobs in by_route.items():
                        route_jobs2 = _enforce_input_cap(route_jobs)
                        bytes_route = _estimate_file_bytes(route_jobs2)
                        if bytes_route <= MAX_BATCH_BYTES:
                            suffix = f"{_slug_for(rq_label, 40)}__{_slug_for(gold_name, 20)}__{_slug_for(route_name, 12)}"
                            planned_files.append((suffix, route_jobs2))
                        else:
                            shard: List[Tuple[Dict[str, Any], str]] = []
                            shard_idx = 1
                            for job, prompt in route_jobs2:
                                test = shard + [(job, prompt)]
                                if _estimate_file_bytes(test) > MAX_BATCH_BYTES and shard:
                                    suffix = f"{_slug_for(rq_label, 36)}__{_slug_for(gold_name, 16)}__{_slug_for(route_name, 8)}__p{shard_idx}"
                                    planned_files.append((suffix, shard))
                                    shard_idx += 1
                                    shard = [(job, prompt)]
                                else:
                                    shard = test
                            if shard:
                                suffix = f"{_slug_for(rq_label, 36)}__{_slug_for(gold_name, 16)}__{_slug_for(route_name, 8)}__p{shard_idx}"
                                planned_files.append((suffix, shard))

    print(f"[PYR-L1] Planned {len(planned_files)} upload file(s).")
    all_jobs_flat: List[Tuple[Dict[str, Any], str]] = [jp for _, arr in planned_files for jp in arr]

    round1_cache = False
    direct_lookup_path = os.path.join(out_dir, "direct_quote_lookup.json")
    quote_hits_path = os.path.join(out_dir, "quote_hits.json")

    if round1_cache and os.path.isfile(direct_lookup_path):
        with open(direct_lookup_path, "r", encoding="utf-8") as f:
            direct_quote_lookup = json.load(f)
    else:
        dql_raw = build_direct_quote_lookup_from_batches(all_jobs_flat)
        direct_quote_lookup = _normalize_direct_quote_lookup(dql_raw)
        os.makedirs(out_dir, exist_ok=True)
        with open(direct_lookup_path, "w", encoding="utf-8") as f:
            json.dump(direct_quote_lookup, f, ensure_ascii=False, indent=2)

    if round1_cache and os.path.isfile(quote_hits_path):
        with open(quote_hits_path, "r", encoding="utf-8") as f:
            quote_hits = json.load(f)
    else:
        pdf_lookup_global = _build_pdf_lookup_from_df_for_inline(df)
        quote_hits = build_quote_hits_from_jobs(
            jobs=[jp for _, arr in planned_files for jp in arr],
            df=df,
            pdf_lookup=pdf_lookup_global,
            threads=32,
            case_sensitive=False,
            cache=True,
            cache_full=True,
            persist_path=quote_hits_path,
        )

    return BatchingArtifacts(
        out_dir=out_dir,
        manifest_path=manifest_path,
        groups=groups,
        planned_files=planned_files,
        all_jobs_flat=all_jobs_flat,
        direct_quote_lookup=direct_quote_lookup,
        quote_hits=quote_hits,
    )
def grouping_widget_data_round2(
    *,
    paragraphs: List[Dict[str, Any]],
    gold_placeholder: str = "NA",
    split_by_date: bool = False,
    dates: str = "",
    overview_cb: Callable[[str], None] | None = None,
    selection_cb: Callable[[str, List[Tuple[int, str]]], List[int]] | None = None,
) -> Dict[str, Any]:
    """
    GROUPING FOR ROUND-2.

    Behaviour
    ---------
    - First layer: route_value (fallback "(no_route_value)").
    - Second layer: rq.
    - Third layer: gold_theme.
    - Fourth layer: tag.

    Modes
    -----
    - Section mode: input rows carry "section_html" (Round-1 or Round-2 sections).
    - Paragraph mode: input rows are paragraph rows with meta_json.

    Interactive behaviour
    ---------------------
    - For each route_value, present an indexed list of RQs and their gold/potential/tag sets.
    - User (or selection_cb) chooses which RQs to keep for that route_value.
    """

    cfg = _R2Config(
        gold_placeholder=gold_placeholder,
        split_by_date=split_by_date,
        dates=dates,
    )

    def _clean_str(x: Any) -> str:
        s = str(x) if x is not None else ""
        return s.strip()

    def _ensure_list_tags(tag_field: Optional[str]) -> List[str]:
        if tag_field is None:
            return ["(untagged)"]
        raw = _clean_str(tag_field)
        if not raw:
            return ["(untagged)"]
        parts = [t.strip() for t in raw.split(";")]
        parts = [p for p in parts if p]
        return parts or ["(untagged)"]

    def _out(msg: str) -> None:
        if overview_cb is not None:
            overview_cb(str(msg))
        else:
            print(str(msg))

    def _prompt_selection(
        rv_key: str,
        rq_items: List[Tuple[str, Dict[str, Dict[str, List[Dict[str, Any]]]]]],
        rq_menu: List[Tuple[int, str]],
        mode_label: str,
    ) -> set[int]:
        keep_indices: set[int] = set()
        if selection_cb is not None:
            indices_raw = selection_cb(str(rv_key), rq_menu) or []
            for i in indices_raw:
                if isinstance(i, int) and 1 <= i <= len(rq_items):
                    keep_indices.add(i)
            return keep_indices

        prompt = (
            "\n[R2 "
            + str(mode_label)
            + "] route_value='"
            + str(rv_key)
            + "' – choose RQ indices to KEEP (comma-separated, empty = all): "
        )
        raw_sel = input(prompt).strip()
        if not raw_sel:
            return keep_indices

        for part in raw_sel.split(","):
            p = part.strip()
            if not p:
                continue
            if p.isdigit():
                idx_val = int(p)
                if 1 <= idx_val <= len(rq_items):
                    keep_indices.add(idx_val)
        return keep_indices

    def _interactive_filter_groups(
        groups: Dict[str, Dict[str, Dict[str, Dict[str, List[Dict[str, Any]]]]]],
        mode_label: str,
    ) -> None:
        _out("\n[R2 " + str(mode_label) + "] interactive overview of grouped buckets:")

        for idx_rv, (rv_key, rq_map) in enumerate(
            sorted(groups.items(), key=lambda kv: str(kv[0])),
            start=1,
        ):
            header = (
                "[R2 "
                + str(mode_label)
                + "] level "
                + str(idx_rv)
                + " > route_value='"
                + str(rv_key)
                + "'"
            )
            _out("\n" + header)

            rq_items: List[Tuple[str, Dict[str, Dict[str, List[Dict[str, Any]]]]]] = list(
                sorted(rq_map.items(), key=lambda kv: str(kv[0]))
            )
            rq_menu: List[Tuple[int, str]] = []

            for idx_rq, (rq_key, gold_map) in enumerate(rq_items, start=1):
                rq_menu.append((idx_rq, str(rq_key)))
                _out("  rq " + str(idx_rq) + " > " + str(rq_key))

                gold_counts: Dict[str, int] = {}
                pot_counts: Dict[str, int] = {}
                tag_counts: Dict[str, int] = {}

                for gold_key, cluster_map in gold_map.items():
                    gold_clean = str(gold_key).strip()
                    if not gold_clean:
                        continue

                    total_for_gold = 0
                    for cluster_label, sec_list in cluster_map.items():
                        count_here = len(sec_list)
                        total_for_gold += count_here

                        tag_clean = str(cluster_label).strip()
                        if tag_clean:
                            prev_tag = tag_counts.get(tag_clean, 0)
                            tag_counts[tag_clean] = prev_tag + count_here

                        for sec in sec_list:
                            pot_val = sec.get("potential_theme")
                            if pot_val is None:
                                continue
                            pot_clean = str(pot_val).strip()
                            if pot_clean and pot_clean != "(unspecified)":
                                prev_pot = pot_counts.get(pot_clean, 0)
                                pot_counts[pot_clean] = prev_pot + 1

                    prev_gold = gold_counts.get(gold_clean, 0)
                    gold_counts[gold_clean] = prev_gold + total_for_gold

                def _print_enum(label: str, counts: Dict[str, int]) -> None:
                    keys_sorted = sorted(counts.keys())
                    _out("    " + label + " (" + str(len(keys_sorted)) + " items):")
                    if not keys_sorted:
                        _out("      (none)")
                        return
                    for i, k in enumerate(keys_sorted, start=1):
                        n = counts.get(k, 0)
                        _out("      " + str(i) + ") " + str(k) + " (" + str(n) + ")")

                _print_enum("gold_theme clusters", gold_counts)
                _print_enum("potential_theme clusters", pot_counts)
                _print_enum("tag_cluster labels", tag_counts)

            keep_indices = _prompt_selection(rv_key, rq_items, rq_menu, mode_label)

            # if keep_indices:
            #     filtered_rq_map: Dict[str, Dict[str, Dict[str, List[Dict[str, Any]]]]] = {}
            #     for idx_rq, (rq_key, gold_map) in enumerate(rq_items, start=1):
            #         if idx_rq in keep_indices:
            #             filtered_rq_map[rq_key] = gold_map
            #     groups[rv_key] = filtered_rq_map
            #     _out(
            #         "[R2 "
            #         + str(mode_label)
            #         + "] kept "
            #         + str(len(filtered_rq_map))
            #         + " RQs for route_value='"
            #         + str(rv_key)
            #         + "'"
            #     )
            # else:
            #     _out(
            #         "[R2 "
            #         + str(mode_label)
            #         + "] no selection provided; keeping all RQs for route_value='"
            #         + str(rv_key)
            #         + "'"
            #     )

        # _out("\n[R2 " + str(mode_label) + "] final summary after selection:")
        # for rv_key, rq_map in groups.items():
        #     total_in_rv = 0
        #     for _, gold_map in rq_map.items():
        #         for _, tag_map in gold_map.items():
        #             for _, rec_list in tag_map.items():
        #                 total_in_rv += len(rec_list)
        #     _out(
        #         "  [summary] route_value='"
        #         + str(rv_key)
        #         + "' grouped_items="
        #         + str(total_in_rv)
        #         + " rq_buckets="
        #         + str(len(rq_map))
        #     )

    rows = list(paragraphs or [])
    total_items = len(rows)

    _out("\n[R2 grouping] incoming rows: " + str(total_items))
    if rows:
        sample = rows[0]
        _out("[R2 grouping] sample[0] keys: " + str(sorted(sample.keys())))
        if "section_html" in sample:
            html0 = sample.get("section_html") or ""
            _out("[R2 grouping] sample[0] section_html_len= " + str(len(str(html0))))
        if "paragraph_html" in sample:
            html1 = sample.get("paragraph_html") or ""
            _out("[R2 grouping] sample[0] paragraph_html_len= " + str(len(str(html1))))
        if "meta_json" in sample:
            mj0 = str(sample.get("meta_json") or "")
            _out("[R2 grouping] sample[0] meta_json prefix: " + mj0[:300])

    is_section_mode = False
    for p in rows:
        if isinstance(p, dict) and "section_html" in p:
            is_section_mode = True
            break

    if is_section_mode:
        route = "route_value → rq → gold_theme → tag"
        groups_s: Dict[str, Dict[str, Dict[str, Dict[str, List[Dict[str, Any]]]]]] = defaultdict(
            lambda: defaultdict(lambda: defaultdict(lambda: defaultdict(list)))
        )
        tag_stats_s: Dict[Tuple[str, str, str], Dict[str, int]] = defaultdict(
            lambda: defaultdict(int)
        )

        def _extract_section_tags(html: Any) -> List[str]:
            txt = _clean_str(html)
            if not txt:
                return []
            tags_counter: Dict[str, int] = {}
            for m in re.finditer(r'<p[^>]*\sdata-tags="([^"]+)"[^>]*>', txt):
                raw = m.group(1)
                for part in raw.split(";"):
                    t = part.strip()
                    if t:
                        tags_counter[t] = tags_counter.get(t, 0) + 1
            if not tags_counter:
                return []
            items = list(tags_counter.items())
            items.sort(key=lambda kv: (-kv[1], len(kv[0]), kv[0].lower()))
            top_items = items[:10]
            rep_tags: List[str] = []
            for idx, (tag, cnt) in enumerate(top_items):
                if idx < 3 or cnt > 5:
                    if tag not in rep_tags:
                        rep_tags.append(tag)
            return rep_tags

        for p in rows:
            if not isinstance(p, dict):
                continue

            rv_raw = p.get("route_value")
            if isinstance(rv_raw, str):
                rv = rv_raw.strip()
            elif rv_raw is None:
                rv = ""
            else:
                rv = str(rv_raw).strip()
            if not rv:
                rv = "(no_route_value)"

            rq_val = p.get("rq")
            meta_inner = p.get("meta")
            if not rq_val and isinstance(meta_inner, dict):
                rq_val = meta_inner.get("rq")
            rq = _clean_str(rq_val) or "(no RQ)"

            gold_val = p.get("gold_theme")
            if not gold_val and isinstance(meta_inner, dict):
                gold_val = meta_inner.get("gold_theme")
            gold = _clean_str(gold_val) or cfg.gold_placeholder

            sec_tags = _extract_section_tags(p.get("section_html"))
            if sec_tags:
                p["tags"] = ";".join(sec_tags)
            tags_list = _ensure_list_tags(p.get("tags"))

            for tg in tags_list:
                groups_s[rv][rq][gold][tg].append(p)
                tag_stats_s[(rv, rq, gold)][tg] += 1

        tag_stats_out_s: Dict[str, Dict[str, int]] = {}
        for (rv, rq, gold), d in tag_stats_s.items():
            tag_stats_out_s[f"{rv} | {rq} | {gold}"] = dict(d)

        _out("[R2 grouping] mode=sections total_items=" + str(total_items))
        _out("[R2 grouping] L1 route_value buckets=" + str(len(groups_s)))

        for rv_key, rq_map in groups_s.items():
            bucket_total = 0
            for _, gold_map in rq_map.items():
                for _, tag_map in gold_map.items():
                    for _, rows_tag in tag_map.items():
                        bucket_total += len(rows_tag)
            _out(
                "  [L1] rv='"
                + str(rv_key)
                + "' items="
                + str(bucket_total)
                + " rq_buckets="
                + str(len(rq_map))
            )

        _interactive_filter_groups(groups_s, mode_label="sections")

        return {
            "route": route,
            "groups": groups_s,
            "tag_stats": tag_stats_out_s,
        }

    route = "route_value → rq → gold_theme → tag"
    groups_rv: Dict[str, Dict[str, Dict[str, Dict[str, List[Dict[str, Any]]]]]] = defaultdict(
        lambda: defaultdict(lambda: defaultdict(lambda: defaultdict(list)))
    )
    tag_stats_rv: Dict[Tuple[str, str, str], Dict[str, int]] = defaultdict(
        lambda: defaultdict(int)
    )

    for p in rows:
        if not isinstance(p, dict):
            continue

        mj = _clean_str(p.get("meta_json"))
        if mj:
            md = json.loads(mj)
        else:
            md = {}

        rv_raw = md.get("route_value")
        if rv_raw is None:
            rv_raw = p.get("route_value")
        if rv_raw is None:
            rv_raw = md.get("route") or p.get("route")

        if isinstance(rv_raw, str):
            rv = rv_raw.strip()
        elif rv_raw is None:
            rv = ""
        else:
            rv = str(rv_raw).strip()
        if not rv:
            rv = "(no_route_value)"

        rq = _clean_str(md.get("rq")) or _clean_str(p.get("rq")) or "(no RQ)"
        gold = _clean_str(md.get("gold_theme")) or _clean_str(p.get("gold_theme")) or cfg.gold_placeholder
        tags_list = _ensure_list_tags(p.get("tags"))

        for tg in tags_list:
            groups_rv[rv][rq][gold][tg].append(p)
            tag_stats_rv[(rv, rq, gold)][tg] += 1

    tag_stats_out_rv: Dict[str, Dict[str, int]] = {}
    for (rv, rq, gold), d in tag_stats_rv.items():
        tag_stats_out_rv[f"{rv} | {rq} | {gold}"] = dict(d)

    _out("[R2 grouping] mode=paragraphs total_items=" + str(total_items))
    _out("[R2 grouping] L1 route_value buckets=" + str(len(groups_rv)))

    for rv_key, rq_map in groups_rv.items():
        bucket_total = 0
        for _, gold_map in rq_map.items():
            for _, tag_map in gold_map.items():
                for _, rows_tag in tag_map.items():
                    bucket_total += len(rows_tag)
        _out(
            "  [L1] rv='"
            + str(rv_key)
            + "' items="
            + str(bucket_total)
            + " rq_buckets="
            + str(len(rq_map))
        )

    _interactive_filter_groups(groups_rv, mode_label="paragraphs")

    return {
        "route": route,
        "groups": groups_rv,
        "tag_stats": tag_stats_out_rv,
    }

def grouping_widget_data_round2_sections(
    *,
    sections: List[Dict[str, Any]],
    gold_placeholder: str = "NA",
    min_tag_freq: int = 3,
    max_clusters: int = 6,
    similarity_threshold: float = 0.75,
    overview_cb: Callable[[str], None] | None = None,
    selection_cb=None) -> Dict[str, Any]:
    """
    GROUPING FOR ROUND-2 (SECTIONS ONLY).

    ###1. normalise tags per section and group by route_value
    ###2. build tag frequency per route_value and cluster tags with fuzzy grouping
    ###3. assign sections to (route_value → rq → gold_theme → tag_cluster) with leftover bucket
    """
    from collections import defaultdict
    import difflib
    import re

    def _clean_str(x: Any) -> str:
        s = str(x) if x is not None else ""
        return s.strip()

    def _out(msg: str) -> None:
        if overview_cb is not None:
            overview_cb(str(msg))
        else:
            print(str(msg))

    def _section_tag_list(raw_tags: Any) -> List[str]:
        if isinstance(raw_tags, dict):
            keys: List[str] = []
            for k, v in raw_tags.items():
                name = _clean_str(k)
                if not name:
                    continue
                if isinstance(v, int) and v > 0:
                    for _ in range(v):
                        keys.append(name)
                else:
                    keys.append(name)
            return keys
        if isinstance(raw_tags, str):
            txt = _clean_str(raw_tags)
            if not txt:
                return []
            parts = [p.strip() for p in txt.split(";")]
            return [p for p in parts if p]
        return []

    def _extract_inline_tags_from_html(html_text: str) -> List[str]:
        txt = _clean_str(html_text)
        if not txt:
            return []
        tags_counter: Dict[str, int] = {}
        for m in re.finditer(r'<p[^>]*\sdata-tags="([^"]+)"[^>]*>', txt):
            raw = m.group(1)
            for part in raw.split(";"):
                t = part.strip()
                if t:
                    tags_counter[t] = tags_counter.get(t, 0) + 1
        tags_sorted: List[str] = []
        for t, _c in sorted(tags_counter.items(), key=lambda kv: (-kv[1], kv[0].lower())):
            tags_sorted.append(t)
        return tags_sorted

    def _canonical_tag_list(sec: Dict[str, Any]) -> List[str]:
        tags_field = sec.get("tags")
        tags = _section_tag_list(tags_field)
        if tags:
            return tags
        html_val = sec.get("section_html") or ""
        return _extract_inline_tags_from_html(str(html_val))

    def _cluster_tags_for_route(
        tag_counts: Dict[str, int],
        min_freq: int,
        max_k: int,
        sim_threshold: float,
    ) -> Dict[str, Dict[str, Any]]:
        def _norm_tag(txt: str) -> str:
            raw = str(txt).lower()
            raw = raw.replace("-", " ").replace("_", " ")
            raw = re.sub(r"[^a-z0-9 ]+", "", raw)
            tokens = [t for t in raw.split() if t]
            stemmed: List[str] = []
            for tok in tokens:
                if len(tok) > 4 and tok.endswith("ies"):
                    stem = tok[:-3] + "y"
                elif len(tok) > 3 and tok.endswith("ses"):
                    stem = tok[:-2]
                elif len(tok) > 3 and tok.endswith("s"):
                    stem = tok[:-1]
                else:
                    stem = tok
                stemmed.append(stem)
            if not stemmed:
                return raw.strip()
            return " ".join(stemmed).strip()

        if not tag_counts:
            return {"clusters": {}, "mapping": {}}

        norm_buckets: Dict[str, Dict[str, Any]] = {}
        for tag, count in tag_counts.items():
            norm = _norm_tag(tag)
            if not norm:
                norm = str(tag).strip().lower()
            info = norm_buckets.get(norm)
            if info is None:
                norm_buckets[norm] = {
                    "tags": [(tag, count)],
                    "total": count,
                }
            else:
                info["tags"].append((tag, count))
                info["total"] += count

        sorted_norms = sorted(
            norm_buckets.items(),
            key=lambda kv: (-kv[1]["total"], kv[0]),
        )

        clusters: Dict[str, Dict[str, Any]] = {}
        tag_to_cluster: Dict[str, str] = {}

        heads: List[Tuple[str, Dict[str, Any]]] = []
        for norm, info in sorted_norms:
            heads.append((norm, info))
            if len(heads) >= max_k:
                break

        for norm, info in heads:
            tag_counts_list = list(info["tags"])
            tag_counts_list.sort(key=lambda kv: (-kv[1], kv[0]))
            head_tag = tag_counts_list[0][0]
            total_count = info["total"]
            clusters[head_tag] = {
                "head": head_tag,
                "tags": [t for t, _c in tag_counts_list],
                "count": total_count,
            }
            for t, _c in tag_counts_list:
                tag_to_cluster[t] = head_tag

        remaining_norms = sorted_norms[len(heads):]

        for norm, info in remaining_norms:
            tag_counts_list = list(info["tags"])
            tag_counts_list.sort(key=lambda kv: (-kv[1], kv[0]))
            tags_only = [t for t, _c in tag_counts_list]
            best_label = None
            best_score = 0.0

            for label, cinfo in clusters.items():
                head_norm = _norm_tag(cinfo["head"])
                score = difflib.SequenceMatcher(a=head_norm, b=norm).ratio()
                if score > best_score:
                    best_score = score
                    best_label = label

            if best_label is not None and best_score >= sim_threshold:
                cinfo = clusters[best_label]
                cinfo["tags"].extend(tags_only)
                added_count = sum(c for _t, c in tag_counts_list)
                cinfo["count"] += added_count
                for t, _c in tag_counts_list:
                    tag_to_cluster[t] = best_label
            else:
                if len(clusters) < max_k:
                    head_tag = tag_counts_list[0][0]
                    total_count = info["total"]
                    clusters[head_tag] = {
                        "head": head_tag,
                        "tags": tags_only,
                        "count": total_count,
                    }
                    for t, _c in tag_counts_list:
                        tag_to_cluster[t] = head_tag
                else:
                    fallback_label = None
                    fallback_score = 0.0
                    for label, cinfo in clusters.items():
                        head_norm = _norm_tag(cinfo["head"])
                        score = difflib.SequenceMatcher(a=head_norm, b=norm).ratio()
                        if score > fallback_score:
                            fallback_score = score
                            fallback_label = label
                    if fallback_label is None:
                        head_tag = tag_counts_list[0][0]
                        clusters[head_tag] = {
                            "head": head_tag,
                            "tags": tags_only,
                            "count": info["total"],
                        }
                        for t, _c in tag_counts_list:
                            tag_to_cluster[t] = head_tag
                    else:
                        cinfo = clusters[fallback_label]
                        cinfo["tags"].extend(tags_only)
                        added_count = sum(c for _t, c in tag_counts_list)
                        cinfo["count"] += added_count
                        for t, _c in tag_counts_list:
                            tag_to_cluster[t] = fallback_label

        return {"clusters": clusters, "mapping": tag_to_cluster}

    sections_list = list(sections or [])
    total_sections = len(sections_list)

    by_route_value: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for sec in sections_list:
        rv_raw = sec.get("route_value")
        if isinstance(rv_raw, str):
            rv = rv_raw.strip()
        elif rv_raw is None:
            rv = ""
        else:
            rv = str(rv_raw).strip()
        if not rv:
            rv = "(no_route_value)"
        by_route_value[rv].append(sec)

    # _out("[R2 sections] rows=" + str(total_sections) + " L1 route_value buckets=" + str(len(by_route_value)))
    for rv_key, secs in by_route_value.items():
        _out("  [L1] route_value='" + str(rv_key) + "' sections=" + str(len(secs)))

    full_groups: Dict[str, Dict[str, Dict[str, Dict[str, List[Dict[str, Any]]]]]] = defaultdict(
        lambda: defaultdict(lambda: defaultdict(lambda: defaultdict(list)))
    )
    tag_clusters_per_rv: Dict[str, Dict[str, Any]] = {}
    leftover_per_rv: Dict[str, Dict[str, int]] = {}

    for rv_key, secs in by_route_value.items():
        tag_counts_rv: Dict[str, int] = {}
        tag_lists_per_sec: Dict[int, List[str]] = {}
        for idx, sec in enumerate(secs):
            tags = _canonical_tag_list(sec)
            tag_lists_per_sec[idx] = tags
            for t in tags:
                tag_counts_rv[t] = tag_counts_rv.get(t, 0) + 1

        _out("[R2 sections] route_value='" + str(rv_key) + "' sections=" + str(len(secs)))
        _out("[R2 sections] route_value tag universe size: " + str(len(tag_counts_rv)))
        top_preview = sorted(tag_counts_rv.items(), key=lambda kv: (-kv[1], kv[0].lower()))[:20]
        for t, c in top_preview:
            _out("    [tag freq] '" + str(t) + "' => " + str(c))

        if tag_counts_rv:
            clust_info = _cluster_tags_for_route(
                tag_counts=tag_counts_rv,
                min_freq=min_tag_freq,
                max_k=max_clusters,
                sim_threshold=similarity_threshold,
            )
        else:
            clust_info = {"clusters": {}, "mapping": {}}

        clusters = clust_info["clusters"]
        tag_to_cluster = clust_info["mapping"]
        tag_clusters_per_rv[rv_key] = {
            "clusters": clusters,
            "tag_to_cluster": tag_to_cluster,
            "tag_counts": dict(tag_counts_rv),
        }

        _out("[R2 sections] route_value='" + str(rv_key) + "' cluster_count=" + str(len(clusters)))
        for label, info in clusters.items():
            _out(
                "    [cluster] label='"
                + str(label)
                + "' tags="
                + str(info["tags"])
                + " total_count="
                + str(info["count"])
            )

        leftover_counts_local: Dict[str, int] = {}
        for idx, sec in enumerate(secs):
            rq_val = _clean_str(sec.get("rq")) or "(no RQ)"
            gold_val = _clean_str(sec.get("gold_theme")) or gold_placeholder
            tags = tag_lists_per_sec.get(idx) or []
            assigned_clusters: List[str] = []

            for t in tags:
                label = tag_to_cluster.get(t)
                if label:
                    assigned_clusters.append(label)

            if not assigned_clusters:
                cluster_label = "(leftover)"
                full_groups[rv_key][rq_val][gold_val][cluster_label].append(sec)
                leftover_counts_local[cluster_label] = leftover_counts_local.get(cluster_label, 0) + 1
            else:
                seen_labels: set[str] = set()
                for label in assigned_clusters:
                    if label in seen_labels:
                        continue
                    seen_labels.add(label)
                    full_groups[rv_key][rq_val][gold_val][label].append(sec)

        leftover_per_rv[rv_key] = dict(leftover_counts_local)
        _out("[R2 sections] route_value='" + str(rv_key) + "' leftover_buckets=" + str(leftover_counts_local))

    for rv_key, rq_map in sorted(full_groups.items(), key=lambda kv: str(kv[0])):
        rq_items = list(sorted(rq_map.items(), key=lambda kv: str(kv[0])))
        rq_menu: List[Tuple[int, str]] = [
            (idx_rq, str(rq_key)) for idx_rq, (rq_key, _gold_map) in enumerate(rq_items, start=1)
        ]

        keep_indices: set[int] = set()
        if selection_cb is not None and rq_menu:
            indices_raw = selection_cb(str(rv_key), rq_menu) or []
            for i in indices_raw:
                if isinstance(i, int) and 1 <= i <= len(rq_items):
                    keep_indices.add(i)

        if keep_indices:
            filtered_rq_map: Dict[str, Dict[str, Dict[str, List[Dict[str, Any]]]]] = {}
            for idx_rq, (rq_key, gold_map) in enumerate(rq_items, start=1):
                if idx_rq in keep_indices:
                    filtered_rq_map[rq_key] = gold_map
            full_groups[rv_key] = filtered_rq_map
            _out(
                "[R2 sections] kept "
                + str(len(filtered_rq_map))
                + " RQs for route_value='"
                + str(rv_key)
                + "'"
            )

    for rv_key, rq_map in full_groups.items():
        total_in_rv = 0
        for _, gold_map in rq_map.items():
            for _, cluster_map in gold_map.items():
                for _, sec_list in cluster_map.items():
                    total_in_rv += len(sec_list)
        _out(
            "  [summary] route_value='"
            + str(rv_key)
            + "' grouped_sections="
            + str(total_in_rv)
            + " rq_buckets="
            + str(len(rq_map))
        )

    route_descriptor = "route_value → rq → gold_theme → tag_cluster"

    return {
        "route": route_descriptor,
        "groups": full_groups,
        "tag_clusters": tag_clusters_per_rv,
        "leftover": leftover_per_rv,
    }


from typing import  Set
from bs4 import BeautifulSoup
import os
import time
import json as _json
from typing import Any, Dict, List, Tuple,  Callable
from collections import defaultdict


def grouping_widget_data_round3(
    *,
    paragraphs: List[Dict[str, Any]],
    gold_placeholder: str = "NA",
    split_by_date: bool = False,
    dates: str = "",
    overview_cb: Callable[[str], None] | None = None,
    selection_cb: Callable[[str, List[Tuple[int, str]]], List[int]] | None = None,
) -> Dict[str, Any]:
    """
    GROUPING FOR ROUND-3 (FILTERED OVER ROUND-2 OUTPUT).

    Behaviour
    ---------
    - Delegates initial grouping to grouping_widget_data_round2.
    - Then filters:
      • keeps only route_value buckets with total items > 15
      • skips route_value buckets with total items <= 15
      • tracks route_value buckets with total items < 10 separately
      • within kept route_values, drops any rq whose total items < 15

    Output
    ------
    {
      "route": <same as round2>,
      "groups": <filtered groups>,
      "tag_stats": <same as round2>,
      "skipped": {
          "route_values": {
              rv: {
                  "total_items": int,
                  "groups": <full rq→gold→tag structure for this rv>,
              },
              ...
          },
          "route_values_lt10": {
              rv: {
                  "total_items": int,
                  "groups": <full rq→gold→tag structure for this rv>,
              },
              ...
          },
          "rqs": {
              rv: {
                  rq: {
                      "total_items": int,
                      "groups": <gold→tag structure for this rq>,
                  },
                  ...
              },
              ...
          },
      },
    }
    """

    def _out(msg: str) -> None:
        if overview_cb is not None:
            overview_cb(str(msg))
        else:
            print(str(msg))

    base = grouping_widget_data_round2(
        paragraphs=paragraphs,
        gold_placeholder=gold_placeholder,
        split_by_date=split_by_date,
        dates=dates,
        overview_cb=overview_cb,
        selection_cb=selection_cb,
    )

    route = base.get("route", "")
    groups = base.get("groups") or {}
    tag_stats = base.get("tag_stats") or {}

    kept_groups: Dict[str, Dict[str, Dict[str, Dict[str, List[Dict[str, Any]]]]]] = defaultdict(
        lambda: defaultdict(lambda: defaultdict(lambda: defaultdict(list)))
    )
    skipped_route_values: Dict[str, Dict[str, Any]] = {}
    skipped_route_values_lt10: Dict[str, Dict[str, Any]] = {}
    skipped_rqs: Dict[str, Dict[str, Dict[str, Any]]] = {}

    def _count_items_rv(rq_map: Dict[str, Dict[str, Dict[str, List[Dict[str, Any]]]]]) -> int:
        total = 0
        for gold_map in rq_map.values():
            for tag_map in gold_map.values():
                for rec_list in tag_map.values():
                    total += len(rec_list or [])
        return total

    def _count_items_rq(gold_map: Dict[str, Dict[str, List[Dict[str, Any]]]]) -> int:
        total = 0
        for tag_map in gold_map.values():
            for rec_list in tag_map.values():
                total += len(rec_list or [])
        return total

    _out("\n[R3 grouping] applying route_value and rq filters (threshold=15 items)")
    _out("[R3 grouping] incoming route_value buckets: " + str(len(groups)))

    for rv_key, rq_map in groups.items():
        if not isinstance(rq_map, dict):
            continue

        total_items_rv = _count_items_rv(rq_map)

        if total_items_rv <= 10:
            skipped_route_values[rv_key] = {
                "total_items": int(total_items_rv),
                "groups": rq_map,
            }
            if total_items_rv < 10:
                skipped_route_values_lt10[rv_key] = {
                    "total_items": int(total_items_rv),
                    "groups": rq_map,
                }
            _out(
                "  [R3 skip rv] route_value='"
                + str(rv_key)
                + "' total_items="
                + str(total_items_rv)
            )
            continue

        rq_kept_for_rv: Dict[str, Dict[str, Dict[str, List[Dict[str, Any]]]]] = {}
        for rq_key, gold_map in rq_map.items():
            if not isinstance(gold_map, dict):
                continue

            total_items_rq = _count_items_rq(gold_map)

            if total_items_rq < 10:
                if rv_key not in skipped_rqs:
                    skipped_rqs[rv_key] = {}
                skipped_rqs[rv_key][rq_key] = {
                    "total_items": int(total_items_rq),
                    "groups": gold_map,
                }
                _out(
                    "    [R3 skip rq] route_value='"
                    + str(rv_key)
                    + "' rq='"
                    + str(rq_key)
                    + "' total_items="
                    + str(total_items_rq)
                )
                continue

            rq_kept_for_rv[rq_key] = gold_map

        if rq_kept_for_rv:
            for rq_key, gold_map in rq_kept_for_rv.items():
                for gold_key, tag_map in gold_map.items():
                    for tag_key, rec_list in tag_map.items():
                        kept_groups[rv_key][rq_key][gold_key][tag_key].extend(rec_list or [])

    _out(
        "[R3 grouping] kept route_value buckets="
        + str(len(kept_groups))
        + " skipped route_value buckets="
        + str(len(skipped_route_values))
    )

    return {
        "route": route,
        "groups": kept_groups,
        "tag_stats": tag_stats,
        "skipped": {
            "route_values": skipped_route_values,
            "route_values_lt10": skipped_route_values_lt10,
            "rqs": skipped_rqs,
        },
    }
def _run_route_groups_multithread(
        label: str,
        route_groups: Dict[str, List[Dict[str, Any]]],
        run_one_route: Callable[
            [str, List[Dict[str, Any]], int, int],
            Tuple[List[Dict[str, Any]], List[str], str],
        ],
        log_cb: Callable[[str], None] | None,
        pct_cb: Callable[[int], None] | None,
        max_workers_cap: int,
) -> Tuple[List[Dict[str, Any]], List[str], str]:
    """
    ###1. fan out per-route job lists to threads
    ###2. invoke route-level runner (enqueue + read) for each route_value
    ###3. aggregate outputs, cids, merged_html and update progress
    """
    outputs_all: List[Dict[str, Any]] = []
    all_cids_all: List[str] = []
    final_html_all: str = ""

    num_route_values = len(route_groups)
    total_jobs = 0
    for rv_key in route_groups:
        total_jobs = total_jobs + len(route_groups[rv_key])

    if callable(log_cb):
        log_cb(
            label
            + ": enqueue, run, and read "
            + str(total_jobs)
            + " job(s) across "
            + str(num_route_values)
            + " route_value collection(s)…"
        )
    if callable(pct_cb):
        pct_cb(0)

    if num_route_values <= 0:
        if callable(pct_cb):
            pct_cb(100)
        return outputs_all, all_cids_all, final_html_all

    max_workers = num_route_values
    if max_workers > max_workers_cap:
        max_workers = max_workers_cap
    if max_workers < 1:
        max_workers = 1

    done_global = 0

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_map = {}
        sorted_routes = sorted(route_groups.keys())
        for index, route_raw in enumerate(sorted_routes, start=1):
            job_list = route_groups[route_raw]
            fut = executor.submit(
                run_one_route,
                route_raw,
                job_list,
                index,
                num_route_values,
            )
            future_map[fut] = route_raw

        for fut in as_completed(future_map):
            route_raw = future_map[fut]
            route_outputs, route_cids, route_html = fut.result()

            outputs_all.extend(route_outputs)
            all_cids_all.extend(route_cids)
            if route_html:
                final_html_all = final_html_all + route_html

            done_global = done_global + len(route_outputs)
            if callable(pct_cb) and total_jobs > 0:
                pct_val = int(done_global * 100 // total_jobs)
                pct_cb(pct_val)

            if callable(log_cb):
                log_cb(
                    label
                    + " route_value="
                    + str(route_raw)
                    + " done_jobs="
                    + str(done_global)
                    + "/"
                    + str(total_jobs)
                )

    if callable(log_cb):
        log_cb(
            label
            + ": completed "
            + str(done_global)
            + "/"
            + str(total_jobs)
            + " job(s)."
        )
        log_cb(label + ": Submitted chunk(s) and read results…")

    if callable(pct_cb):
        pct_cb(100)

    return outputs_all, all_cids_all, final_html_all
def running_round3(
    collection_name: str,
    df: Any,
    quote_hits,
    direct_quote_lookup,
    batch: "BatchingArtifacts",
    user_prompt: str,
    pyr_l2_sections: List[Dict[str, Any]],
    framework_analysis: bool = False,
    progress_cb: Callable[[str], None] | None = None,
    percent_cb: Callable[[int], None] | None = None,
) -> Tuple[
    List[Dict[str, Any]],
    List[str],
    str,
    int,
    List[Dict[str, Any]],
]:
    """
    ROUND-3 EXECUTION (SECTIONS ONLY).

    ###1. inspect pyr_l2_sections structure and route_value distribution
    ###2. normalise meta → section payloads for grouping_widget_data_round2_sections
    ###3. filter: first by route_value unique sections (>=15), then by rq unique sections (>=10)
    ###4. batch filtered groups with batching_widget_data_round2
    ###5. enqueue, run, and read Round-3 model calls for filtered buckets
    ###6. reconstitute skipped and leftover items as passthrough sections
    """

    def _r3_log(msg: str) -> None:
        if callable(progress_cb):
            progress_cb(str(msg))
        else:
            print(str(msg))

    def _r3_pct(val: int) -> None:
        if callable(percent_cb):
            percent_cb(int(val))

    def _make_req_input_r3(prompt: str, payload: List[Dict[str, Any]]) -> str:
        head = "SECTIONS(JSON):"
        body = json.dumps(payload, ensure_ascii=False, indent=2)
        p = str(prompt or "").rstrip()
        if p:
            return p + "\n\n" + head + "\n" + body
        return head + "\n" + body

    def _prepare_l3_fields(md2: Dict[str, Any]) -> Dict[str, str]:
        rq_val = (
            md2.get("rq")
            or md2.get("layer2_key")
            or ""
        )
        rq_val = str(rq_val).strip()
        if not rq_val:
            rq_val = "(no RQ)"

        gold_theme_val = (
            md2.get("gold_theme")
            or md2.get("theme_label")
            or "NA"
        )
        gold_theme_val = str(gold_theme_val).strip()
        if not gold_theme_val:
            gold_theme_val = "NA"

        potential_theme_val = md2.get("potential_theme") or "(unspecified)"
        potential_theme_val = str(potential_theme_val).strip()
        if not potential_theme_val:
            potential_theme_val = "(unspecified)"

        evidence_type_val = md2.get("evidence_type") or "mixed"
        evidence_type_val = str(evidence_type_val).strip()
        if not evidence_type_val:
            evidence_type_val = "mixed"

        route_label_val = (
            md2.get("layer_structure")
            or md2.get("route")
            or "fallback"
        )
        route_label_val = str(route_label_val).strip()
        if not route_label_val:
            route_label_val = "fallback"

        route_value_val = (
            md2.get("route_value")
            or md2.get("date_range")
            or rq_val
        )
        route_value_val = str(route_value_val).strip()
        if not route_value_val:
            route_value_val = rq_val

        return {
            "rq": rq_val,
            "gold_theme": gold_theme_val,
            "potential_theme": potential_theme_val,
            "evidence_type": evidence_type_val,
            "route": route_label_val,
            "route_value": route_value_val,
        }

    def _clean_section_html(val: Any) -> str:
        if not isinstance(val, str):
            return ""
        txt = val.strip()
        if not txt:
            return ""
        if txt == "(None, None)":
            print("[WARN] dropping placeholder HTML '(None, None)' in section_html (R3)")
            return ""
        return txt

    def _section_char_len_r3(rec: Dict[str, Any]) -> int:
        html_val = rec.get("section_html") or rec.get("paragraph_html") or rec.get("html") or ""
        return len(str(html_val))

    QPS_R3: float = 4.0

    def _r3_pause() -> float:
        if QPS_R3 <= 0:
            return 0.0
        value = 1.0 / float(QPS_R3)
        if value > 0:
            return value
        return 0.0

    index_counter = getattr(batch, "pyr_global_index_counter", 1)

    def _next_index_key() -> str:
        nonlocal index_counter
        value = index_counter
        index_counter = index_counter + 1
        return "idx_" + str(value).zfill(5)

    sections_r3: List[Dict[str, Any]] = list(pyr_l2_sections or [])

    _r3_log(
        "[R3] Round-2 sections incoming for R3 grouping: total="
        + str(len(sections_r3))
    )

    print("[R3 DEBUG] pyr_l2_sections sample (first 3 records):")
    for idx, sec in enumerate(sections_r3[:3], start=1):
        if isinstance(sec, dict):
            meta = sec.get("meta") or {}
            print("  idx=", idx, " top-level keys=", sorted(sec.keys()))
            print("    meta keys=", sorted(meta.keys()))
            print(
                "    meta.route_value=",
                repr(meta.get("route_value")),
                " meta.rq=",
                repr(meta.get("rq")),
            )

    section_payloads_r3: List[Dict[str, Any]] = []
    for sec in sections_r3:
        if not isinstance(sec, dict):
            continue
        meta = sec.get("meta") or {}
        html_val = sec.get("section_html") or ""
        section_payloads_r3.append(
            {
                "section_custom_id": str(meta.get("custom_id") or ""),
                "rq": str(meta.get("rq") or ""),
                "gold_theme": str(meta.get("gold_theme") or ""),
                "potential_theme": str(meta.get("potential_theme") or ""),
                "evidence_type": str(meta.get("evidence_type") or "mixed"),
                "route": str(meta.get("route") or "fallback"),
                "route_value": str(meta.get("route_value") or ""),
                "section_html": str(html_val or ""),
            }
        )

    rv_debug: Dict[str, int] = {}
    for row in section_payloads_r3:
        rv_raw = row.get("route_value")
        if isinstance(rv_raw, str):
            rv = rv_raw.strip()
        elif rv_raw is None:
            rv = ""
        else:
            rv = str(rv_raw).strip()
        if not rv:
            rv = "(empty)"
        rv_debug[rv] = rv_debug.get(rv, 0) + 1

    print("[R3 DEBUG] pre-group route_value distribution from pyr_l2_sections:")
    for rv_key, cnt in sorted(rv_debug.items(), key=lambda kv: str(kv[0])):
        print("  rv='" + str(rv_key) + "' sections=" + str(cnt))

    grouped_base = grouping_widget_data_round2_sections(
        sections=section_payloads_r3,
        gold_placeholder="NA",
        overview_cb=progress_cb,
        selection_cb=None,
    )

    full_groups = grouped_base.get("groups") or {}

    route_min_sections = 10
    rq_min_sections = 10

    def _sec_id(rec: Dict[str, Any]) -> str:
        sid = rec.get("section_custom_id") or rec.get("custom_id")
        if isinstance(sid, str) and sid.strip():
            return sid.strip()
        return "rec_" + str(id(rec))

    def _unique_ids_in_gold_map(gold_map: Dict[str, Dict[str, List[Dict[str, Any]]]]) -> set:
        ids: set = set()
        for _, cluster_map in gold_map.items():
            for _, sec_list in cluster_map.items():
                for rec in sec_list or []:
                    if isinstance(rec, dict):
                        ids.add(_sec_id(rec))
        return ids

    skipped_route_values: Dict[str, Dict[str, Any]] = {}
    skipped_rqs: Dict[str, Dict[str, Any]] = {}
    groups_filtered: Dict[str, Dict[str, Dict[str, Dict[str, List[Dict[str, Any]]]]]] = {}

    for rv_key, rq_map in full_groups.items():
        rv_ids: set = set()
        rq_id_sets: Dict[str, set] = {}

        for rq_key, gold_map in rq_map.items():
            ids_for_rq = _unique_ids_in_gold_map(gold_map)
            rq_id_sets[rq_key] = ids_for_rq
            rv_ids |= ids_for_rq

        rv_unique_count = len(rv_ids)

        if rv_unique_count < route_min_sections:
            skipped_route_values[rv_key] = {
                "groups": rq_map,
            }
            continue

        new_rq_map: Dict[str, Dict[str, Dict[str, List[Dict[str, Any]]]]] = {}

        for rq_key, gold_map in rq_map.items():
            ids_for_rq = rq_id_sets.get(rq_key) or set()
            rq_unique_count = len(ids_for_rq)
            if rq_unique_count >= rq_min_sections:
                new_rq_map[rq_key] = gold_map
            else:
                if rv_key not in skipped_rqs:
                    skipped_rqs[rv_key] = {}
                skipped_rqs[rv_key][rq_key] = {
                    "groups": {rq_key: gold_map},
                }

        groups_filtered[rv_key] = new_rq_map

    grouped_r3: Dict[str, Any] = {
        "route": grouped_base.get("route"),
        "groups": groups_filtered,
        "tag_clusters": grouped_base.get("tag_clusters") or {},
        "leftover": grouped_base.get("leftover") or {},
        "skipped": {
            "route_values": skipped_route_values,
            "rqs": skipped_rqs,
        },
    }

    skipped_info = grouped_r3.get("skipped") or {}
    skipped_route_values = skipped_info.get("route_values") or {}
    skipped_rqs = skipped_info.get("rqs") or {}

    groups_included = grouped_r3.get("groups") or {}

    print("[R3 grouping] included groups after rv/rq filters (unique section counts):")
    for rv_key, rq_map in sorted(groups_included.items(), key=lambda kv: str(kv[0])):
        for rq_key, gold_map in sorted(rq_map.items(), key=lambda kv: str(kv[0])):
            ids_local = _unique_ids_in_gold_map(gold_map)
            items_count = len(ids_local)
            print(
                "  included rv='"
                + str(rv_key)
                + "' rq='"
                + str(rq_key)
                + "' sections="
                + str(items_count)
            )

    print("[R3 grouping] skipped groups by route_value (rv dropped entirely, unique section counts):")
    for rv_key, payload in sorted(skipped_route_values.items(), key=lambda kv: str(kv[0])):
        groups_rv = payload.get("groups") or {}
        rv_ids_local: set = set()
        for _, gold_map in groups_rv.items():
            rv_ids_local |= _unique_ids_in_gold_map(gold_map)
        print(
            "  skipped(rv) rv='"
            + str(rv_key)
            + "' sections_skipped="
            + str(len(rv_ids_local))
        )

    print("[R3 grouping] skipped groups by rq (rq dropped inside surviving rv, unique section counts):")
    for rv_key, rq_map in sorted(skipped_rqs.items(), key=lambda kv: str(kv[0])):
        for rq_key, payload in rq_map.items():
            groups_rq = payload.get("groups") or {}
            ids_local: set = set()
            for _, gold_map in groups_rq.items():
                ids_local |= _unique_ids_in_gold_map(gold_map)
            print(
                "  skipped(rq) rv='"
                + str(rv_key)
                + "' rq='"
                + str(rq_key)
                + "' sections_skipped="
                + str(len(ids_local))
            )

    # input("overview of groups")

    _r3_log(
        "[R3] grouping complete; skipped route_values="
        + str(len(skipped_route_values))
        + " skipped_rqs_buckets="
        + str(len(skipped_rqs))
    )

    r3_plan = batching_widget_data_round2(
        grouped=grouped_r3,
        prompt=user_prompt,
        analysis_mode="theme",
        layer1_key=None,
        round2="sections",
        framework_analysis=framework_analysis,
    )

    logical_jobs3: List[Dict[str, Any]] = r3_plan.get("batches", []) or []
    leftover_singletons3: List[Dict[str, Any]] = r3_plan.get("leftover_singletons") or []

    _r3_log(
        "[R3] logical_jobs3 initial="
        + str(len(logical_jobs3))
        + " leftover_singletons3="
        + str(len(leftover_singletons3))
    )

    route_groups3: Dict[str, List[Dict[str, Any]]] = {}
    for jb in logical_jobs3:
        if not isinstance(jb, dict):
            continue
        md_local = jb.get("metadata") or {}
        rv_local = str(md_local.get("route_value") or "").strip()
        if not rv_local:
            rv_local = "mixed_route"
        if rv_local not in route_groups3:
            route_groups3[rv_local] = []
        route_groups3[rv_local].append(jb)

    num_route_values3 = len(route_groups3)
    total_jobs3 = 0
    for rv_key in route_groups3:
        total_jobs3 += len(route_groups3[rv_key])

    _r3_log(
        "[R3] Grouped Round-3 jobs by route_value: "
        + str(num_route_values3)
        + " route_value bucket(s), "
        + str(total_jobs3)
        + " job(s)"
    )

    def _stable_base_sans_time_r3(s: str) -> str:
        v = (s or "").strip()
        v = re.sub(r"^run_\d{8}_\d{6}_", "run_", v)
        if not v.startswith("run_"):
            v = "run_" + v
        v = re.sub(r"_+", "_", v)
        return v.rstrip("_")

    def _extract_html_r3(raw: Any) -> str:
        if isinstance(raw, str):
            return raw
        if isinstance(raw, dict):
            for k in ("html", "result", "response", "payload", "output"):
                v = raw.get(k)
                if isinstance(v, str) and v.strip():
                    return v
        if isinstance(raw, (list, tuple)) and raw:
            first = raw[0]
            if isinstance(first, str) and first.strip():
                return first
            if isinstance(first, dict):
                for k in ("html", "result", "response", "payload", "output"):
                    v = first.get(k)
                    if isinstance(v, str) and v.strip():
                        return v
        if raw is not None:
            return str(raw)
        return ""

    def _run_route_group_r3(
            route_raw: str,
            job_list: List[Dict[str, Any]],
            collection_name: str,
            num_route_values3: int,
            rv_index: int,
    ) -> Tuple[List[Dict[str, Any]], List[str], str]:
        outputs_local: List[Dict[str, Any]] = []
        all_cids_local: List[str] = []
        final_html_local: str = ""

        prompt_key_pyr_l3 = "pyr_l2_html"

        r3_base = _stable_base_sans_time_r3(str(collection_name))

        route_norm = re.sub(r"[^0-9A-Za-z\\-]+", "_", route_raw)
        route_norm = re.sub(r"_+", "_", route_norm).strip("_")
        if not route_norm:
            route_norm = "mixed_route"

        sub_collection = r3_base + "_" + route_norm + "_pyr_l3_html"

        total_payload_items = 0
        total_chars = 0
        min_chars: int | None = None
        max_chars: int | None = None

        for jb in job_list:
            payloads_jb = list(jb.get("payloads") or [])
            total_payload_items = total_payload_items + len(payloads_jb)
            for rec in payloads_jb:
                if not isinstance(rec, dict):
                    continue
                length = _section_char_len_r3(rec)
                total_chars = total_chars + length
                if min_chars is None or length < min_chars:
                    min_chars = length
                if max_chars is None or length > max_chars:
                    max_chars = length

        if min_chars is None:
            min_chars = 0
        if max_chars is None:
            max_chars = 0

        _r3_log(
            "[R3 SUMMARY] sub_collection="
            + sub_collection
            + " route_value_index="
            + str(rv_index)
            + "/"
            + str(num_route_values3)
            + " jobs="
            + str(len(job_list))
            + " payload_items="
            + str(total_payload_items)
            + " chars_total="
            + str(total_chars)
            + " chars_min="
            + str(min_chars)
            + " chars_max="
            + str(max_chars)
        )

        queued_jobs: List[Tuple[str, Dict[str, Any]]] = []
        last_send_ts3: float = 0.0
        pause3: float = _r3_pause()

        _r3_log(
            "[R3] ENQUEUE route_value bucket "
            + str(rv_index)
            + "/"
            + str(num_route_values3)
            + " route_value="
            + str(route_raw)
            + " ("
            + str(len(job_list))
            + " jobs) → "
            + sub_collection
        )

        for j_index, job in enumerate(job_list, start=1):
            now = time.time()
            since = now - last_send_ts3
            if pause3 > 0 and since < pause3:
                time.sleep(pause3 - since)
            last_send_ts3 = time.time()

            payload_list = list(job.get("payloads") or [])
            full_prompt_for_model = str(job.get("prompt") or "")

            req_input = _make_req_input_r3(
                prompt=full_prompt_for_model,
                payload=payload_list,
            )

            existing = job.get("cid") or job.get("custom_id")
            if isinstance(existing, str):
                existing_str = existing.strip()
            else:
                existing_str = ""

            if existing_str:
                cid = existing_str
            else:
                cid= _make_custom_index_keys(req_input, idx)

            index_key = _next_index_key()

            md_local = job.get("metadata") or {}
            md_local["custom_id"] = cid
            md_local["index_key"] = index_key
            job["metadata"] = md_local

            all_cids_local.append(cid)
            queued_jobs.append((cid, job))

            _r3_log(
                "[ENQUEUE R3] "
                + cid
                + " | index_key="
                + index_key
                + " | items="
                + str(len(payload_list))
                + " (route_value="
                + str(route_raw)
                + ")"
            )

            _ = call_models_old_backin(
                text=req_input,
                function=prompt_key_pyr_l3,
                custom_id=cid,
                collection_name=sub_collection,
                read=False,
                store_only=True,
                ai=os.getenv("OPENAI_AI_PROVIDER", "openai"),
            )

        _process_batch_for(
            function=prompt_key_pyr_l3,
            collection_name=sub_collection,
            wait=True,
            download_if_ready=True,
        )
        _r3_log(
            "[R3] Batch complete for "
            + sub_collection
            + "; reading results…"
        )
        index_raw = 0
        for cid_local, job_local in queued_jobs:
            resp_obj = call_models_old_backin(
                text="",
                function=prompt_key_pyr_l3,
                custom_id=cid_local,
                collection_name=sub_collection,
                read=True,
                by_index=index_raw,
                store_only=False,
            )
            index_raw = index_raw + 1

            html_raw_local = _extract_html_r3(resp_obj)
            html_proc_local = postprocess_html_with_quotes_and_apa(
                html_raw_local,
                direct_quote_lookup=direct_quote_lookup,
                df=df,

            )

            _r3_log(
                "[READ R3] "
                + cid_local
                + " (route_value="
                + str(route_raw)
                + ")"
            )

            if html_proc_local:
                final_html_local = final_html_local + html_proc_local

            outputs_local.append(
                {
                    "custom_id": cid_local,
                    "prompt": str(job_local.get("prompt") or ""),
                    "analysis_prompt": str(
                        job_local.get("analysis_prompt") or ""
                    ),
                    "payload_size": int(len(job_local.get("payloads") or [])),
                    "response_html": html_raw_local,
                    "processed_html": html_proc_local,
                    "metadata": job_local.get("metadata") or {},
                }
            )

        return outputs_local, all_cids_local, final_html_local

    num_route_values3 = len(route_groups3)
    total_jobs3 = 0
    for rv_key in route_groups3:
        total_jobs3 = total_jobs3 + len(route_groups3[rv_key])

    outputs3, all_cids_round3, final_merged_html3 = _run_route_groups_multithread(
        label="[R3] Route=sections",
        route_groups=route_groups3,
        run_one_route=lambda route_raw, job_list, rv_index, num_rv: _run_route_group_r3(
            route_raw=route_raw,
            job_list=job_list,
            collection_name=collection_name,
            num_route_values3=num_rv,
            rv_index=rv_index,
        ),
        log_cb=_r3_log,
        pct_cb=_r3_pct,
        max_workers_cap=8,
    )
    total_outputs3 = len(outputs3)
    print("[R3 DEBUG] outputs3 total=", total_outputs3)

    pyr_l3_sections: List[Dict[str, Any]] = []
    sections_from_nonempty_html = 0

    for o in outputs3:
        cid_raw = o.get("custom_id")
        if isinstance(cid_raw, str):
            cid = cid_raw.strip()
        else:
            cid = ""
        if not cid:
            cid = "pyr_l3_job"

        html_block = o.get("processed_html") or o.get("response_html") or ""
        html_clean = _clean_section_html(html_block)
        if not html_clean:
            print(
                "[DEBUG R3] skipping cid with empty section_html after clean:",
                repr(cid),
            )
            continue

        md3 = o.get("metadata") or {}
        f = _prepare_l3_fields(md3)

        sections_from_nonempty_html = sections_from_nonempty_html + 1

        pyr_l3_sections.append(
            {
                "meta": {
                    "custom_id": cid,
                    "rq": f["rq"],
                    "gold_theme": f["gold_theme"],
                    "potential_theme": f["potential_theme"],
                    "evidence_type": f["evidence_type"],
                    "route": f["route"],
                    "route_value": f["route_value"],
                },
                "section_html": html_block,
            }
        )

    print(
        "[R3 DEBUG] sections_from_nonempty_html=",
        sections_from_nonempty_html,
        "pyr_l3_sections_len_before_passthrough=",
        len(pyr_l3_sections),
    )

    passthrough_counter = 0
    passthrough_seen_ids: set = set()

    def _source_id_for_passthrough(rec: Dict[str, Any]) -> str:
        meta_inner = rec.get("meta") or {}
        sid = rec.get("section_custom_id")
        if isinstance(sid, str) and sid.strip():
            return sid.strip()
        sid2 = meta_inner.get("custom_id")
        if isinstance(sid2, str) and sid2.strip():
            return sid2.strip()
        sid3 = rec.get("custom_id")
        if isinstance(sid3, str) and sid3.strip():
            return sid3.strip()
        return ""

    def _append_passthrough_from_section(rec: Dict[str, Any]) -> None:
        nonlocal passthrough_counter, final_merged_html3

        html_block_raw = str(
            rec.get("section_html")
            or rec.get("paragraph_html")
            or ""
        )
        html_block_raw = _clean_section_html(html_block_raw)
        if not html_block_raw:
            return

        src_id = _source_id_for_passthrough(rec)
        if src_id:
            if src_id in passthrough_seen_ids:
                return
            passthrough_seen_ids.add(src_id)

        meta_inner = rec.get("meta") or {}

        meta_raw = {
            "rq": rec.get("rq") or meta_inner.get("rq"),
            "gold_theme": rec.get("gold_theme") or meta_inner.get("gold_theme"),
            "potential_theme": rec.get("potential_theme") or meta_inner.get("potential_theme"),
            "evidence_type": rec.get("evidence_type") or meta_inner.get("evidence_type"),
            "route": rec.get("route") or meta_inner.get("route"),
            "route_value": rec.get("route_value") or meta_inner.get("route_value"),
        }
        prepared = _prepare_l3_fields(meta_raw)

        html_block_proc = postprocess_html_with_quotes_and_apa(
            html_block_raw,
            direct_quote_lookup=direct_quote_lookup,
            df=df,

        )

        html_block_final = html_block_proc or html_block_raw
        html_block_final = _clean_section_html(html_block_final)
        if not html_block_final:
            return

        passthrough_counter = passthrough_counter + 1
        cid2 = "pyr_l3_singleton_" + str(passthrough_counter)

        pyr_l3_sections.append(
            {
                "meta": {
                    "custom_id": cid2,
                    "rq": prepared["rq"],
                    "gold_theme": prepared["gold_theme"],
                    "potential_theme": prepared["potential_theme"],
                    "evidence_type": prepared["evidence_type"],
                    "route": prepared["route"],
                    "route_value": prepared["route_value"],
                },
                "section_html": html_block_final,
            }
        )

        outputs3.append(
            {
                "custom_id": cid2,
                "prompt": "",
                "analysis_prompt": "",
                "payload_size": 1,
                "response_html": html_block_raw,
                "processed_html": html_block_final,
                "metadata": meta_raw,
            }
        )
        all_cids_round3.append(cid2)

        final_merged_html3 = final_merged_html3 + html_block_final

    for idx, rec in enumerate(leftover_singletons3 or [], start=1):
        if isinstance(rec, dict):
            _append_passthrough_from_section(rec)

    for rv_key, payload in skipped_route_values.items():
        groups_rv = payload.get("groups") or {}
        for rq_key, gold_map in groups_rv.items():
            for gold_key, cluster_map in gold_map.items():
                for tag_key, sec_list in cluster_map.items():
                    for rec in sec_list or []:
                        if isinstance(rec, dict):
                            _append_passthrough_from_section(rec)

    for rv_key, rq_map in skipped_rqs.items():
        for rq_key, payload in rq_map.items():
            groups_rq = payload.get("groups") or {}
            for rq_inner, gold_map in groups_rq.items():
                for gold_key, cluster_map in gold_map.items():
                    for tag_key, sec_list in cluster_map.items():
                        for rec in sec_list or []:
                            if isinstance(rec, dict):
                                _append_passthrough_from_section(rec)

    num_batches3 = len(logical_jobs3)

    _r3_log(
        "[R3] passthrough sections appended from skipped buckets and leftovers: "
        + str(passthrough_counter)
    )

    setattr(batch, "pyr_global_index_counter", index_counter)

    return (
        outputs3,
        all_cids_round3,
        final_merged_html3,
        num_batches3,
        pyr_l3_sections,
    )


def running_round2(
    collection_name: str,
    df: Any,
    quote_hits,
    direct_quote_lookup,
    batch: "BatchingArtifacts",
    user_prompt: str,
    round1_sections_merged: List[Dict[str, Any]],
    round2: str,
    framework_analysis: bool,
    progress_cb: Callable[[str], None] | None = None,
    percent_cb: Callable[[int], None] | None = None,
) -> Tuple[
    List[Dict[str, Any]],
    List[str],
    str,
    int,
    List[Dict[str, Any]],
    List[Tuple[dict, str]],
]:
    """
    ###1. plan and enqueue Round-2 jobs (paragraph or section route)
    ###2. read and postprocess Round-2 outputs with APA/anchors
    ###3. build pyr_l2_sections and export-ready job list
    """

    dq_lookup_local = direct_quote_lookup

    def _r2_log(msg: str) -> None:
        if callable(progress_cb):
            progress_cb(msg)

    def _r2_pct(val: int) -> None:
        if callable(percent_cb):
            percent_cb(val)

    MAX_BATCH_BYTES: int = 209_715_200
    MAX_INPUT_BYTES: int = 10_000_000

    QPS_R2: float = 4.0
    MAX_INPUT_BYTES_R2: int = MAX_INPUT_BYTES
    MAX_BATCH_BYTES_R2: int = min(MAX_BATCH_BYTES, 128_000_000)

    def _r2_pause() -> float:
        if QPS_R2 <= 0:
            return 0.0
        value = 1.0 / float(QPS_R2)
        if value > 0:
            return value
        return 0.0

    def _extract_paragraph_rows_from_sections(
        sections_list: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        from html import unescape as _unesc

        out_rows: List[Dict[str, Any]] = []

        p_block_regex = re.compile(
            r"(<p\b[^>]*>.*?</p>)",
            flags=re.IGNORECASE | re.DOTALL,
        )
        id_regex = re.compile(r'id="([^"]+)"', flags=re.IGNORECASE)
        tags_regex = re.compile(
            r'data-tags="([^"]+)"',
            flags=re.IGNORECASE,
        )

        for sec in sections_list or []:
            meta = sec.get("meta") or {}
            sec_html = sec.get("section_html") or ""
            if not isinstance(sec_html, str):
                continue
            sec_html_str = sec_html.strip()
            if not sec_html_str:
                continue

            for m in p_block_regex.finditer(sec_html_str):
                p_html_full = m.group(1)

                pid_m = id_regex.search(p_html_full)
                para_id = pid_m.group(1) if pid_m else ""

                tags_m = tags_regex.search(p_html_full)
                tags_val = tags_m.group(1) if tags_m else None
                if tags_val:
                    tags_val = _unesc(tags_val)

                meta_payload = {
                    "rq": meta.get("rq"),
                    "gold_theme": meta.get("gold_theme"),
                    "potential_theme": meta.get("potential_theme"),
                    "evidence_type": meta.get("evidence_type"),
                    "route": meta.get("route"),
                    "route_value": meta.get("route_value"),
                    "year": meta.get("year"),
                }

                out_rows.append(
                    {
                        "custom_id": str(meta.get("custom_id") or ""),
                        "paragraph_id": str(para_id or ""),
                        "tags": tags_val,
                        "paragraph_html": p_html_full,
                        "meta_json": _json.dumps(
                            meta_payload,
                            ensure_ascii=False,
                        ),
                        "rq": meta.get("rq"),
                        "gold_theme": meta.get("gold_theme"),
                        "potential_theme": meta.get("potential_theme"),
                        "evidence_type": meta.get("evidence_type"),
                        "route": meta.get("route"),
                        "route_value": meta.get("route_value"),
                    }
                )

        return out_rows

    def _needs_date_split(rows: List[Dict[str, Any]]) -> bool:
        date_pattern = re.compile(
            r"\b(20[0-4]\d|19\d{2})(?:[-/](0[1-9]|1[0-2])(?:[-/](0[1-9]|[12]\d|3[01]))?)?\b"
        )
        for r in rows or []:
            mj = r.get("meta_json") or ""
            if isinstance(mj, str) and date_pattern.search(mj):
                return True
            ph = r.get("paragraph_html") or ""
            if isinstance(ph, str) and date_pattern.search(ph):
                return True
        return False

    def _make_req_input(kind: str, prompt: str, payload: Any) -> str:
        """
        ###1. retain only section_html + tags (+ basic meta)
        ###2. clean section_html (strip coverage comments, fix anchors)
        ###3. inject direct-quote verbatim text into title attr (dq_lookup_local)
        ###4. concatenate prompt + JSON payload
        """
        rx_cov = re.compile(
            r"<!--\s*coverage\s+used=.*?-->\s*$",
            flags=re.IGNORECASE | re.DOTALL,
        )

        def _fix_citation_anchors(html: str) -> str:
            h = str(html or "")
            h = re.sub(
                r"</a>\s*</a>",
                "</a>",
                h,
                flags=re.IGNORECASE,
            )
            h = re.sub(
                r"<a([^>]*\bdata-key=\"[^\"]+\"[^>]*)>.*?</a>",
                r"<a\1></a>",
                h,
                flags=re.IGNORECASE | re.DOTALL,
            )
            return h

        def _inject_verbatim_in_anchor(html: str) -> str:
            def repl(m: re.Match) -> str:
                dqid = m.group(1)
                key_val = m.group(2)
                dqtext = dq_lookup_local.get(dqid, "")
                dqtext = dqtext.strip().replace('"', "&quot;")
                return (
                    f'<a data-quote-id="{dqid}" '
                    f'title="{dqtext}" data-key="{key_val}"></a>'
                )

            h = str(html or "")
            h = re.sub(
                r'<a[^>]*data-quote-id="([^"]+)"[^>]*data-key="([^"]+)"[^>]*></a>',
                repl,
                h,
                flags=re.IGNORECASE,
            )
            return h

        head = "JSON:"
        if kind == "sections":
            head = "SECTIONS(JSON):"
        elif kind == "paragraphs":
            head = "PARAGRAPHS(JSON):"

        if kind in ("sections", "paragraphs"):
            cleaned: List[Dict[str, Any]] = []
            for rec in payload or []:
                if not isinstance(rec, dict):
                    continue

                html_val = ""
                if round2 == "paragraphs":
                    html_val = rec.get("paragraph_html") or rec.get("section_text") or ""
                else:
                    html_val = (
                        rec.get("section_html")
                        or rec.get("paragraph_html")
                        or rec.get("section_text")
                        or ""
                    )

                html_str = str(html_val or "")

                if not html_str.strip():
                    cid_dbg = rec.get("section_custom_id") or rec.get("custom_id") or ""
                    rq_dbg = rec.get("rq") or ""
                    gold_dbg = rec.get("gold_theme") or ""
                    pot_dbg = rec.get("potential_theme") or ""
                    rv_dbg = rec.get("route_value") or ""
                    tags_dbg = rec.get("tags") or ""
                    sec_raw_dbg = rec.get("section_html")
                    para_raw_dbg = rec.get("paragraph_html")

                    print("\n========== EMPTY SECTION_HTML DIAGNOSTICS ==========")
                    print("CID:", cid_dbg)
                    print("RQ:", rq_dbg)
                    print("Gold:", gold_dbg)
                    print("Potential:", pot_dbg)
                    print("Route_value:", rv_dbg)
                    print("Tags:", tags_dbg)
                    print(
                        "section_html raw:",
                        type(sec_raw_dbg),
                        "len=",
                        0 if sec_raw_dbg is None else len(str(sec_raw_dbg)),
                    )
                    print(
                        "paragraph_html raw:",
                        type(para_raw_dbg),
                        "len=",
                        0 if para_raw_dbg is None else len(str(para_raw_dbg)),
                    )
                    print(
                        "Full record dump:",
                        json.dumps(rec, ensure_ascii=False)[:500],
                        "...",
                    )
                    print("====================================================\n")

                html_clean = rx_cov.sub("", html_str)
                html_clean = _fix_citation_anchors(html_clean)
                html_clean = _inject_verbatim_in_anchor(html_clean)
                html_clean = re.sub(r"\s+", " ", html_clean).strip()

                row: Dict[str, Any] = {"section_html": html_clean}

                tags_val = rec.get("tags")
                tags_list: List[str] = []

                if isinstance(tags_val, dict):
                    for key, val in tags_val.items():
                        if val:
                            tag_txt = str(key).strip()
                            if tag_txt:
                                tags_list.append(tag_txt)
                elif isinstance(tags_val, str):
                    for part in tags_val.split(";"):
                        tag_txt = part.strip()
                        if tag_txt:
                            tags_list.append(tag_txt)
                elif isinstance(tags_val, (list, tuple)):
                    for item in tags_val:
                        tag_txt = str(item).strip()
                        if tag_txt:
                            tags_list.append(tag_txt)

                seen_tags: Set[str] = set()
                norm_tags: List[str] = []
                for t in tags_list:
                    if t not in seen_tags:
                        seen_tags.add(t)
                        norm_tags.append(t)

                if norm_tags:
                    row["tags"] = ";".join(norm_tags)

                    tag_counts: Dict[str, int] = {}
                    for t in tags_list:
                        tag_counts[t] = tag_counts.get(t, 0) + 1
                    row["tag_counts"] = tag_counts

                for k in (
                    "rq",
                    "gold_theme",
                    "potential_theme",
                    "evidence_type",
                    "route",
                    "route_value",
                ):
                    v = rec.get(k)
                    if v is not None:
                        row[k] = v

                cleaned.append(row)

            body = json.dumps(cleaned, ensure_ascii=False, indent=2)
        else:
            body = json.dumps(payload, ensure_ascii=False, indent=2)

        p = str(prompt or "").rstrip()
        if p:
            return p + "\n\n" + head + "\n" + body
        return head + "\n" + body

    def _enforce_batch_size(
        jobs: List[Dict[str, Any]], target: int, overlap: int
    ) -> List[Dict[str, Any]]:
        out: List[Dict[str, Any]] = []
        stride: int = target - overlap
        if stride <= 0:
            stride = 1
        for job in jobs or []:
            payloads: List[Dict[str, Any]] = list(job.get("payloads") or [])
            if not payloads:
                continue
            if len(payloads) <= target:
                out.append(job)
                continue
            pos: int = 0
            n: int = len(payloads)
            while pos < n:
                chunk = payloads[pos : pos + target]
                if not chunk:
                    break
                j2 = dict(job)
                j2["payloads"] = chunk
                out.append(j2)
                pos += stride
        return out

    def _estimate_job_bytes(kind: str, job: Dict[str, Any]) -> int:
        payload_list = list(job.get("payloads") or [])
        full_prompt_for_model = str(job.get("prompt") or "")
        preview = _make_req_input(
            kind=kind,
            prompt=full_prompt_for_model,
            payload=payload_list,
        )
        return len(preview.encode("utf-8"))

    def _cap_single_job(
        kind: str, job: Dict[str, Any], limit_bytes: int
    ) -> List[Dict[str, Any]]:
        payloads = list(job.get("payloads") or [])
        if not payloads:
            return [job]

        total_chars = 0
        has_paragraph = False
        has_section = False

        for p in payloads:
            if isinstance(p, dict):
                ph = p.get("paragraph_html")
                sh = p.get("section_html")
                if isinstance(ph, str) and ph:
                    html_val = ph
                    has_paragraph = True
                elif isinstance(sh, str) and sh:
                    html_val = sh
                    has_section = True
                else:
                    html_val = p.get("html") or ""
                total_chars += len(str(html_val))
            else:
                total_chars += len(str(p))

        if has_paragraph:
            char_cap = 50000
        elif has_section:
            char_cap = 60000
        else:
            char_cap = 60000

        jobs_after_char_cap: List[Dict[str, Any]] = []

        if total_chars > char_cap:
            cur_payloads: List[Dict[str, Any]] = []
            cur_chars: int = 0

            for p in payloads:
                if isinstance(p, dict):
                    ph = p.get("paragraph_html")
                    sh = p.get("section_html")
                    if isinstance(ph, str) and ph:
                        html_val = ph
                    elif isinstance(sh, str) and sh:
                        html_val = sh
                    else:
                        html_val = p.get("html") or ""
                    length = len(str(html_val))
                else:
                    length = len(str(p))

                if cur_payloads and cur_chars + length > char_cap:
                    j2 = dict(job)
                    j2["payloads"] = cur_payloads
                    jobs_after_char_cap.append(j2)
                    cur_payloads = [p]
                    cur_chars = length
                else:
                    cur_payloads.append(p)
                    cur_chars += length

            if cur_payloads:
                j2 = dict(job)
                j2["payloads"] = cur_payloads
                jobs_after_char_cap.append(j2)
        else:
            jobs_after_char_cap.append(job)

        out_jobs: List[Dict[str, Any]] = []

        for base_job in jobs_after_char_cap:
            size_now = _estimate_job_bytes(kind, base_job)
            if size_now <= limit_bytes:
                out_jobs.append(base_job)
                continue

            base_payloads = list(base_job.get("payloads") or [])
            chunks: List[Dict[str, Any]] = []
            cur: List[Dict[str, Any]] = []

            for p in base_payloads:
                candidate = cur + [p]
                tmp = dict(base_job)
                tmp["payloads"] = candidate
                if cur and _estimate_job_bytes(kind, tmp) > limit_bytes:
                    j2 = dict(base_job)
                    j2["payloads"] = cur
                    chunks.append(j2)
                    cur = [p]
                else:
                    cur = candidate

            if cur:
                j2 = dict(base_job)
                j2["payloads"] = cur
                chunks.append(j2)

            out_jobs.extend(chunks)

        return out_jobs

    def _cid_for_job(job: Dict[str, Any], seq: int) -> str:
        existing = job.get("cid") or job.get("custom_id")
        if isinstance(existing, str):
            existing = existing.strip()
        else:
            existing = ""
        if existing:
            return existing
        return f"pyr_l2_b{seq:04d}"

    def _count_tags_in_section_html(html_text: str) -> Dict[str, int]:
        tags_count: Dict[str, int] = {}
        soup = BeautifulSoup(html_text or "", "html.parser")
        for p in soup.find_all("p"):
            raw = p.get("data-tags")
            if isinstance(raw, str) and raw.strip():
                for t in raw.split(";"):
                    tt = t.strip()
                    if tt:
                        tags_count[tt] = tags_count.get(tt, 0) + 1
        return tags_count

    def extract_section_tags(html_text: str) -> Dict[str, int]:
        """
        ###1. count tags in section_html
        ###2. return dict[tag] = count (all tags, no dominance filter)
        """
        counts = _count_tags_in_section_html(html_text)
        return dict(counts)

    def _section_payloads_from_round1(
        sections_list: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        out: List[Dict[str, Any]] = []
        for sec in sections_list or []:
            meta = sec.get("meta") or {}
            html_text_val = sec.get("section_html") or ""
            html_text = html_text_val if isinstance(html_text_val, str) else ""
            tag_counts = extract_section_tags(html_text)
            tags_field = tag_counts if tag_counts else {}

            out.append(
                {
                    "section_custom_id": str(meta.get("custom_id") or ""),
                    "rq": str(meta.get("rq") or ""),
                    "gold_theme": str(meta.get("gold_theme") or ""),
                    "potential_theme": str(
                        meta.get("potential_theme") or ""
                    ),
                    "evidence_type": str(
                        meta.get("evidence_type") or "mixed"
                    ),
                    "route": str(meta.get("route") or "fallback"),
                    "route_value": str(meta.get("route_value") or ""),
                    "section_html": html_text,
                    "tags": tags_field,
                }
            )

        return out

    kind: str = "paragraphs"
    if isinstance(round2, str) and round2.strip().lower() == "sections":
        kind = "sections"

    para_rows: List[Dict[str, Any]] = _extract_paragraph_rows_from_sections(
        round1_sections_merged
    )
    total_paras: int = len(para_rows)

    print("\n[R2 DEBUG] para_rows total=", total_paras)
    if para_rows:
        rec0 = para_rows[0]
        print("[R2 DEBUG] para_rows[0] keys:", sorted(rec0.keys()))
        ph0 = rec0.get("paragraph_html") or ""
        mj0 = rec0.get("meta_json") or ""
        print("[R2 DEBUG] para_rows[0] paragraph_html_len=", len(str(ph0)))
        print("[R2 DEBUG] para_rows[0] meta_json prefix:", str(mj0)[:300])

    with_tags: int = 0
    unique_tags_set: Set[str] = set()
    sample_ids: List[str] = []
    plain_len_sum: int = 0
    strip_html_rx = re.compile(r"<[^>]+>")

    for rec in para_rows:
        pid = rec.get("paragraph_id") or ""
        if pid and len(sample_ids) < 5:
            sample_ids.append(pid)
        tags_val = rec.get("tags")
        if isinstance(tags_val, str) and tags_val.strip():
            with_tags += 1
            for t in tags_val.split(";"):
                tt = t.strip()
                if tt:
                    unique_tags_set.add(tt)
        para_html = rec.get("paragraph_html") or ""
        if isinstance(para_html, str):
            txt = strip_html_rx.sub("", para_html)
            plain_len_sum += len(txt)

    avg_len: float = 0.0
    if total_paras > 0:
        avg_len = float(plain_len_sum) / float(total_paras)
    uniq_tags_count: int = len(unique_tags_set)

    _r2_log(
        f"[R2] Paragraph rows ready: total={total_paras}, "
        f"with-tags={with_tags}, unique-tags={uniq_tags_count}, "
        f"avg-plain-chars≈{int(avg_len)}"
    )
    if sample_ids:
        _r2_log(
            "[R2] Paragraph sample ids: "
            + ", ".join(sample_ids)
        )
    else:
        _r2_log("[R2] Paragraph sample ids: (none)")

    section_payloads: List[Dict[str, Any]] = _section_payloads_from_round1(
        round1_sections_merged
    )

    total_sections = len(section_payloads)
    nonempty_sections = 0
    for row in section_payloads:
        html_val = row.get("section_html")
        if isinstance(html_val, str) and html_val.strip():
            nonempty_sections += 1

    _r2_log(
        f"[R2] Section payloads ready: total={total_sections}, "
        f"non-empty HTML={nonempty_sections}"
    )

    if kind == "paragraphs":
        split_by_date: bool = _needs_date_split(para_rows)
        grp2 = grouping_widget_data_round2(
            paragraphs=para_rows,
            gold_placeholder="NA",
            split_by_date=split_by_date,
            dates="",
        )
        print("len sections\n", len(section_payloads))
    else:
        grp2 = grouping_widget_data_round2_sections(
            sections=section_payloads,
        )

        route_dbg = grp2.get("route")
        groups_dbg = grp2.get("groups") or {}
        nonempty_buckets = 0
        for rv_key, rq_map in groups_dbg.items():
            if not isinstance(rq_map, dict):
                continue
            for rq_key, gold_map in rq_map.items():
                if not isinstance(gold_map, dict):
                    continue
                for gold_key, tag_map in gold_map.items():
                    if not isinstance(tag_map, dict):
                        continue
                    for tag_key, rows_b in tag_map.items():
                        n_rows = len(rows_b or [])
                        if n_rows <= 0:
                            continue
                        nonempty_buckets += 1
        print("[R2 grouping] nonempty_buckets=", nonempty_buckets)

    r2_plan = batching_widget_data_round2(
        grouped=grp2,
        prompt=user_prompt,
        analysis_mode="theme",
        layer1_key=None,
        round2=round2,
        framework_analysis=framework_analysis,
    )
    logical_jobs2 = r2_plan.get("batches", []) or []
    leftover_singletons = r2_plan.get("leftover_singletons") or []

    _r2_log(
        f"[R2] leftover_singletons={len(leftover_singletons)} "
        f"from_round1_sections={len(round1_sections_merged)}"
    )

    print("[R2 plan] logical_jobs2 initial=" + str(len(logical_jobs2)))

    rv_batch_counts: Dict[str, int] = {}
    for job in logical_jobs2:
        md = job.get("metadata") or {}
        rv_key = str(md.get("route_value") or "")
        if not rv_key:
            rv_key = "(no_route_value)"
        rv_batch_counts[rv_key] = rv_batch_counts.get(rv_key, 0) + 1

    num_batches2 = len(logical_jobs2)
    _r2_log(
        f"[PYR-L2] Planned {num_batches2} logical R2 job(s) "
        f"before size caps · route={kind}"
    )

    capped_jobs2: List[Dict[str, Any]] = []

    if kind == "sections":
        total_jobs_before_caps = len(logical_jobs2)
        total_chars_before_caps = 0
        for job in logical_jobs2:
            md = job.get("metadata") or {}
            approx_chars = int(md.get("approx_chars") or 0)
            total_chars_before_caps += approx_chars
        _r2_log(
            f"[R2 SECTIONS] skipping _cap_single_job · "
            f"logical_jobs={total_jobs_before_caps} "
            f"approx_chars_total={total_chars_before_caps}"
        )
        capped_jobs2 = list(logical_jobs2)
    else:
        for job in logical_jobs2:
            capped_jobs2.extend(
                _cap_single_job(kind, job, MAX_INPUT_BYTES_R2)
            )
        _r2_log(
            f"[R2 {kind.upper()}] {len(capped_jobs2)} job(s) after character/byte caps"
        )

    route_groups: Dict[str, List[Dict[str, Any]]] = {}
    for jb in capped_jobs2:
        if not isinstance(jb, dict):
            continue
        md_local = jb.get("metadata") or {}
        rv_local = str(md_local.get("route_value") or "").strip()
        if not rv_local:
            rv_local = "mixed_route"
        if rv_local not in route_groups:
            route_groups[rv_local] = []
        route_groups[rv_local].append(jb)

    num_route_values = len(route_groups)
    total_jobs = 0
    for rv_key in route_groups:
        total_jobs += len(route_groups[rv_key])

    _r2_log(
        f"[PYR-L2] Grouped Round-2 jobs by route_value: "
        f"{num_route_values} route_value bucket(s), {total_jobs} job(s)"
    )
    outputs2: List[Dict[str, Any]] = []
    final_merged_html: str = ""
    all_cids_round2: List[str] = []

    r2_total_jobs: int = total_jobs
    r2_done: int = 0

    index_counter = getattr(batch, "pyr_global_index_counter", 1)

    def _next_index_pair() -> Tuple[int, str]:
        nonlocal index_counter
        value = index_counter
        index_counter = index_counter + 1
        return value, "idx_" + str(value).zfill(5)



    _r2_log(
        f"Round 2: enqueue, run, and read {r2_total_jobs} job(s) "
        f"across {num_route_values} route_value collection(s)…"
    )
    _r2_pct(0)

    def _stable_base_sans_time(s: str) -> str:
        v = (s or "").strip()
        v = re.sub(r"^run_\d{8}_\d{6}_", "run_", v)
        if not v.startswith("run_"):
            v = "run_" + v
        v = re.sub(r"_+", "_", v)
        return v.rstrip("_")

    def _extract_html_round2(raw) -> str:
        if isinstance(raw, str):
            return raw
        if isinstance(raw, dict):
            for k in ("html", "result", "response", "payload", "output"):
                v = raw.get(k)
                if isinstance(v, str) and v.strip():
                    return v
        if isinstance(raw, (list, tuple)) and raw:
            first = raw[0]
            if isinstance(first, str) and first.strip():
                return first
            if isinstance(first, dict):
                for k in ("html", "result", "response", "payload", "output"):
                    v = first.get(k)
                    if isinstance(v, str) and v.strip():
                        return v
        if raw is not None:
            return str(raw)
        return ""

    from concurrent.futures import ThreadPoolExecutor, as_completed

    def _run_route_bucket(
            route_raw: str,
            job_list: List[Dict[str, Any]],
            rv_index: int,
            num_rv: int,
    ) -> Tuple[List[Dict[str, Any]], List[str], str, int]:
        local_outputs: List[Dict[str, Any]] = []
        local_cids: List[str] = []
        local_html: str = ""
        local_done: int = 0

        r2_base = _stable_base_sans_time(str(collection_name))

        route_norm = re.sub(r"[^0-9A-Za-z\-]+", "_", route_raw)
        route_norm = re.sub(r"_+", "_", route_norm).strip("_")
        if not route_norm:
            route_norm = "mixed_route"

        sub_collection = f"{r2_base}_{route_norm}"

        _r2_log(
            "[PYR-L2] ENQUEUE route_value bucket "
            + str(rv_index)
            + "/"
            + str(num_rv)
            + " route_value="
            + str(route_raw)
            + " ("
            + str(len(job_list))
            + " jobs) → "
            + sub_collection
        )

        total_payload_items = 0
        total_chars = 0
        first_len = True
        min_chars = 0
        max_chars = 0

        for jb in job_list:
            payloads_jb = list(jb.get("payloads") or [])
            total_payload_items = total_payload_items + len(payloads_jb)
            for rec in payloads_jb:
                if not isinstance(rec, dict):
                    continue
                html_val = rec.get("section_html") or rec.get("paragraph_html") or ""
                length = len(str(html_val))
                total_chars = total_chars + length
                if first_len:
                    min_chars = length
                    max_chars = length
                    first_len = False
                else:
                    if length < min_chars:
                        min_chars = length
                    if length > max_chars:
                        max_chars = length

        _r2_log(
            "[PYR-L2 SUMMARY] sub_collection="
            + sub_collection
            + " route_value_index="
            + str(rv_index)
            + "/"
            + str(num_rv)
            + " jobs="
            + str(len(job_list))
            + " payload_items="
            + str(total_payload_items)
            + " chars_total="
            + str(total_chars)
            + " chars_min="
            + str(min_chars)
            + " chars_max="
            + str(max_chars)
        )

        pause_value = _r2_pause()
        cids_this_collection: List[str] = []

        for job in job_list:
            if pause_value > 0.0:
                time.sleep(pause_value)

            payload_list = list(job.get("payloads") or [])
            full_prompt_for_model = str(job.get("prompt") or "")

            req_input = _make_req_input(
                kind=kind,
                prompt=full_prompt_for_model,
                payload=payload_list,
            )

            idx_value, index_key = _next_index_pair()

            existing = job.get("cid") or job.get("custom_id")
            if isinstance(existing, str):
                existing_str = existing.strip()
            else:
                existing_str = ""

            if existing_str:
                cid = existing_str
            else:
                cid = _make_custom_index_keys(req_input, idx_value)

            md_local = job.get("metadata") or {}
            md_local["custom_id"] = cid
            md_local["index_key"] = index_key
            job["metadata"] = md_local


            _r2_log(
                "[ENQUEUE R2] "
                + cid
                + " | index_key="
                + index_key
                + " | items="
                + str(len(payload_list))
                + " (route_value="
                + str(route_raw)
                + ")"
            )

            _ = call_models_old_backin(
                text=req_input,
                function="pyr_l2_html",
                custom_id=cid,
                collection_name=sub_collection,
                read=False,
                store_only=True,

                ai=os.getenv("OPENAI_AI_PROVIDER", "openai"),
            )

            cids_this_collection.append(cid)
            local_cids.append(cid)

        _process_batch_for(
            function="pyr_l2_html",
            collection_name=sub_collection,
            wait=True,
            download_if_ready=True,
        )
        _r2_log(
            "[R2] Batch complete for "
            + sub_collection
            + "; reading results…"
        )

        for cid, job in zip(cids_this_collection, job_list):
            _r2_log(
                "[READ R2] "
                + cid
                + " (route_value="
                + str(route_raw)
                + ")"
            )

            resp_obj = call_models_old_backin(
                text="",
                function="pyr_l2_html",
                custom_id=cid,
                collection_name=sub_collection,
                read=True,
                store_only=False,

            )

            html_raw = _extract_html_round2(resp_obj)

            html_proc = postprocess_html_with_quotes_and_apa(
                html_raw,
                direct_quote_lookup=batch.direct_quote_lookup,
                df=df
            )

            if html_proc:
                local_html = local_html + html_proc

            local_outputs.append(
                {
                    "custom_id": cid,
                    "prompt": str(job.get("prompt") or ""),
                    "analysis_prompt": str(
                        job.get("analysis_prompt") or ""
                    ),
                    "payload_size": int(
                        len(job.get("payloads") or [])
                    ),
                    "response_html": html_raw,
                    "processed_html": html_proc,
                    "metadata": job.get("metadata") or {},
                }
            )

            local_done = local_done + 1

        return local_outputs, local_cids, local_html, local_done

    def _run_route_groups_multithread(
            label: str,
            route_groups: Dict[str, List[Dict[str, Any]]],
            run_one_route: Callable[
                [str, List[Dict[str, Any]], int, int],
                Tuple[List[Dict[str, Any]], List[str], str, int],
            ],
            log_cb: Callable[[str], None] | None,
            pct_cb: Callable[[int], None] | None,
            max_workers_cap: int,
    ) -> Tuple[List[Dict[str, Any]], List[str], str]:
        """
        ###1. fan out per-route job lists to threads
        ###2. invoke route-level runner for each route_value
        ###3. aggregate outputs, cids, merged_html and update progress
        """
        outputs_all: List[Dict[str, Any]] = []
        all_cids_all: List[str] = []
        final_html_all: str = ""

        num_route_values = len(route_groups)
        total_jobs = 0
        for rv_key in route_groups:
            total_jobs = total_jobs + len(route_groups[rv_key])

        if callable(log_cb):
            log_cb(
                label
                + ": enqueue, run, and read "
                + str(total_jobs)
                + " job(s) across "
                + str(num_route_values)
                + " route_value collection(s)…"
            )
        if callable(pct_cb):
            pct_cb(0)

        if num_route_values <= 0:
            if callable(pct_cb):
                pct_cb(100)
            return outputs_all, all_cids_all, final_html_all

        max_workers = num_route_values
        if max_workers > max_workers_cap:
            max_workers = max_workers_cap
        if max_workers < 1:
            max_workers = 1

        done_global = 0

        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            future_map: Dict[Any, str] = {}
            sorted_routes = sorted(route_groups.keys())
            for index, route_raw in enumerate(sorted_routes, start=1):
                job_list = route_groups[route_raw]
                fut = executor.submit(
                    run_one_route,
                    route_raw,
                    job_list,
                    index,
                    num_route_values,
                )
                future_map[fut] = route_raw

            for fut in as_completed(future_map):
                route_raw = future_map[fut]
                route_outputs, route_cids, route_html, _ = fut.result()

                outputs_all.extend(route_outputs)
                all_cids_all.extend(route_cids)
                if route_html:
                    final_html_all = final_html_all + route_html

                done_global = done_global + len(route_outputs)
                if callable(pct_cb) and total_jobs > 0:
                    pct_val = int(done_global * 100 // total_jobs)
                    pct_cb(pct_val)

                if callable(log_cb):
                    log_cb(
                        label
                        + " route_value="
                        + str(route_raw)
                        + " done_jobs="
                        + str(done_global)
                        + "/"
                        + str(total_jobs)
                    )

        if callable(log_cb):
            log_cb(
                label
                + ": completed "
                + str(done_global)
                + "/"
                + str(total_jobs)
                + " job(s)."
            )
            log_cb(label + ": Submitted chunk(s) and read results…")

        if callable(pct_cb):
            pct_cb(100)

        return outputs_all, all_cids_all, final_html_all

    outputs2, all_cids_round2, final_merged_html = _run_route_groups_multithread(
        label="Round 2",
        route_groups=route_groups,
        run_one_route=_run_route_bucket,
        log_cb=_r2_log,
        pct_cb=_r2_pct,
        max_workers_cap=4,
    )

    _r2_log(
        "[R2] Route="
        + str(kind)
        + " · Prepared "
        + str(num_batches2)
        + " logical job(s)"
    )
    _r2_log("[R2] Submitted chunk(s) and read results…")

    def _prepare_l2_fields(md2: Dict[str, Any]) -> Dict[str, str]:
        rq_val = (
            md2.get("rq")
            or md2.get("layer2_key")
            or ""
        )
        rq_val = rq_val.strip()
        if not rq_val:
            rq_val = "(no RQ)"

        gold_theme_val = (
            md2.get("gold_theme")
            or md2.get("theme_label")
            or "NA"
        )
        gold_theme_val = gold_theme_val.strip()
        if not gold_theme_val:
            gold_theme_val = "NA"

        potential_theme_val = md2.get("potential_theme") or "(unspecified)"
        potential_theme_val = potential_theme_val.strip()
        if not potential_theme_val:
            potential_theme_val = "(unspecified)"

        evidence_type_val = md2.get("evidence_type") or "mixed"
        evidence_type_val = evidence_type_val.strip()
        if not evidence_type_val:
            evidence_type_val = "mixed"

        route_label_val = (
            md2.get("layer_structure")
            or md2.get("route")
            or "fallback"
        )
        route_label_val = route_label_val.strip()
        if not route_label_val:
            route_label_val = "fallback"

        route_value_val = (
            md2.get("route_value")
            or md2.get("date_range")
            or rq_val
        )
        route_value_val = str(route_value_val).strip()
        if not route_value_val:
            route_value_val = rq_val

        return {
            "rq": rq_val,
            "gold_theme": gold_theme_val,
            "potential_theme": potential_theme_val,
            "evidence_type": evidence_type_val,
            "route": route_label_val,
            "route_value": route_value_val,
        }

    def _clean_section_html(val: Any) -> str:
        if not isinstance(val, str):
            return ""
        txt = val.strip()
        if not txt:
            return ""
        if txt == "(None, None)":
            print("[WARN] dropping placeholder HTML '(None, None)' in section_html")
            return ""
        return txt
    cid_to_processed: Dict[Tuple[str, str], Tuple[str, Dict[str, Any]]] = {}

    total_outputs2 = len(outputs2)
    empty_after_clean = 0

    for o in outputs2:
        cid_raw = o.get("custom_id")
        cid_val = cid_raw if isinstance(cid_raw, str) else ""
        cid_val = cid_val.strip()
        if not cid_val:
            continue

        md2 = o.get("metadata") or {}
        rv_raw = md2.get("route_value") or md2.get("date_range") or ""
        rv_val = str(rv_raw).strip()
        if not rv_val:
            rv_val = "(no_route_value)"

        composite_key = (rv_val, cid_val)

        html_block_val = (
            o.get("processed_html")
            or o.get("response_html")
            or ""
        )
        html_clean_dbg = _clean_section_html(html_block_val)
        if not html_clean_dbg:
            empty_after_clean = empty_after_clean + 1

        cid_to_processed[composite_key] = (html_block_val, md2)

    print(
        "[R2 DEBUG] outputs2 summary:",
        "total_outputs2=", total_outputs2,
        "unique_keys(rv,cid)=", len(cid_to_processed),
        "empty_html_blocks_after_clean=", empty_after_clean,
    )

    pyr_l2_sections: List[Dict[str, Any]] = []

    for (rv_key, cid), (html_block, md2) in cid_to_processed.items():
        html_clean = _clean_section_html(html_block)
        if not html_clean:
            print(
                "[DEBUG] skipping cid with empty section_html after clean:",
                repr((rv_key, cid)),
            )
            continue

        f = _prepare_l2_fields(md2)
        pyr_l2_sections.append(
            {
                "meta": {
                    "custom_id": cid,
                    "rq": f["rq"],
                    "gold_theme": f["gold_theme"],
                    "potential_theme": f["potential_theme"],
                    "evidence_type": f["evidence_type"],
                    "route": f["route"],
                    "route_value": f["route_value"],
                },
                "section_html": html_block,
            }
        )

    print(
        "[R2 DEBUG] pyr_l2_sections built:",
        "sections_from_outputs2=", len(pyr_l2_sections),
    )


    for idx, rec in enumerate(leftover_singletons or [], start=1):
        if isinstance(rec, dict):
            rec_dict = rec
        else:
            rec_dict = {}

        html_block = str(
            rec_dict.get("section_html")
            or rec_dict.get("paragraph_html")
            or ""
        )
        html_block = _clean_section_html(html_block)
        if not html_block:
            continue

        meta_raw = {
            "rq": rec_dict.get("rq"),
            "gold_theme": rec_dict.get("gold_theme"),
            "potential_theme": rec_dict.get("potential_theme"),
            "evidence_type": rec_dict.get("evidence_type"),
            "route": rec_dict.get("route"),
            "route_value": rec_dict.get("route_value"),
        }
        f2 = _prepare_l2_fields(meta_raw)
        cid2_raw = (
                rec_dict.get("section_custom_id")
                or rec_dict.get("custom_id")
                or f"pyr_l2_singleton_{idx}"
        )
        if isinstance(cid2_raw, str):
            cid2 = cid2_raw
        else:
            cid2 = str(cid2_raw)
        cid2 = cid2.strip()
        if not cid2:
            cid2 = f"pyr_l2_singleton_{idx}"

        pyr_l2_sections.append(
            {
                "meta": {
                    "custom_id": cid2,
                    "rq": f2["rq"],
                    "gold_theme": f2["gold_theme"],
                    "potential_theme": f2["potential_theme"],
                    "evidence_type": f2["evidence_type"],
                    "route": f2["route"],
                    "route_value": f2["route_value"],
                },
                "section_html": html_block,
            }
        )

        final_merged_html += html_block

    jobs_for_export: List[Tuple[dict, str]] = []
    if batch.planned_files:
        for (_suffix, jobs_for_file) in batch.planned_files:
            for tup in jobs_for_file:
                if (
                        isinstance(tup, (list, tuple))
                        and len(tup) == 2
                        and isinstance(tup[0], dict)
                ):
                    jobs_for_export.append((tup[0], str(tup[1])))
                elif isinstance(tup, dict):
                    jobs_for_export.append((tup, ""))

    setattr(batch, "pyr_global_index_counter", index_counter)

    return (
        outputs2,
        all_cids_round2,
        final_merged_html,
        num_batches2,
        pyr_l2_sections,
        jobs_for_export,
    )


def running_rounds(
    collection_name: str,

    df: Any,
    quote_hits,
    direct_quote_lookup,
    batch: "BatchingArtifacts",
    user_prompt: str,
    progress_cb: Callable[[str], None] | None = None,
    percent_cb: Callable[[int], None] | None = None,
    round2: str = "paragraphs",
    framework_analysis: bool = True,
) -> "RoundResults":
    if callable(progress_cb):
        progress_cb(
            "[RUNTIME] Round-2 route: "
            + str(round2)
            + " · framework_analysis="
            + str(bool(framework_analysis))
        )

    results_round1_logs, round1_sections_merged = running_round1(
        collection_name=collection_name,
        df=df,
        quote_hits=quote_hits,
        direct_quote_lookup=direct_quote_lookup,
        batch=batch,
        progress_cb=progress_cb,
        percent_cb=percent_cb,
    )

    (
        outputs2,
        all_cids_round2,
        final_merged_html_r2,
        num_batches2,
        pyr_l2_sections,
        jobs_for_export,
    ) = running_round2(
        collection_name=collection_name,
        df=df,
        quote_hits=quote_hits,
        direct_quote_lookup=direct_quote_lookup,
        batch=batch,
        user_prompt=user_prompt,
        round1_sections_merged=round1_sections_merged,
        round2=round2,
        framework_analysis=framework_analysis,
        progress_cb=progress_cb,
        percent_cb=percent_cb,
    )

    (
        outputs3,
        all_cids_round3,
        final_merged_html_r3,
        num_batches3,
        pyr_l3_sections,
    ) = running_round3(
        collection_name=collection_name,
        df=df,
        quote_hits=quote_hits,
        direct_quote_lookup=direct_quote_lookup,
        batch=batch,
        user_prompt=user_prompt,
        pyr_l2_sections=pyr_l2_sections,
        framework_analysis=framework_analysis,
        progress_cb=progress_cb,
        percent_cb=percent_cb,
    )

    final_merged_html_all = str(final_merged_html_r2 or "") + str(final_merged_html_r3 or "")
    export_paths = export_pyr_all_artifacts(
        jobs=jobs_for_export,
        sections=round1_sections_merged,
        out_dir=batch.out_dir,
        df=df,
        basename_batches="pyr_l1_batches",
        basename_sections="pyr_l1_sections",
        r2_outputs=outputs2,
        r2_sections=pyr_l2_sections,
        r2_merged_html=final_merged_html_r2,
        r3_outputs=outputs3,
        r3_sections=pyr_l3_sections,
        r3_merged_html=final_merged_html_r3,
        quote_hits=quote_hits,
        direct_quote_lookup=direct_quote_lookup,
        inputs_modal=getattr(batch, "inputs_modal", None),
        inputs_grouped=getattr(batch, "inputs_grouped", None),
        inputs_batches=getattr(batch, "inputs_batches", None),
    )


    return RoundResults(
        outputs_round1=results_round1_logs,
        round1_sections_merged=round1_sections_merged,
        outputs_round2=outputs2,
        custom_ids_round2=all_cids_round2,
        outputs_round3=outputs3,
        custom_ids_round3=all_cids_round3,
        round3_sections_merged=pyr_l3_sections,
        num_batches_round3=num_batches3,

        final_merged_html=final_merged_html_all,
        export_paths=export_paths,
        num_batches_round2=num_batches2,
    )


def running_round1(
    collection_name: str,
    df: Any,
    quote_hits,
    direct_quote_lookup,
    batch: "BatchingArtifacts",
    progress_cb: Callable[[str], None] | None = None,
    percent_cb: Callable[[int], None] | None = None,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """
    ###1. enqueue all Round-1 jobs (per planned_files suffix)
    ###2. read and postprocess Round-1 outputs into sections
    ###3. use on-disk cache when possible, return logs + merged sections
    """


    index_raw = getattr(batch, "pyr_global_index_counter", None)
    if isinstance(index_raw, int) and index_raw > 0:
        cid_index_counter = index_raw
    else:
        cid_index_counter = 1

    def _next_index() -> int:
        nonlocal cid_index_counter
        value = cid_index_counter
        cid_index_counter = cid_index_counter + 1
        return value

    def _extract_html(raw) -> str:
        if isinstance(raw, str):
            return raw
        if isinstance(raw, dict):
            for k in ("html", "result", "response", "payload", "output"):
                v = raw.get(k)
                if isinstance(v, str) and v.strip():
                    return v
        if isinstance(raw, (list, tuple)) and raw:
            first = raw[0]
            if isinstance(first, str) and first.strip():
                return first
            if isinstance(first, dict):
                for k in ("html", "result", "response", "payload", "output"):
                    v = first.get(k)
                    if isinstance(v, str) and v.strip():
                        return v
        return str(raw) if raw is not None else ""

    def _majority_evidence_type(records: dict) -> str:
        counts: Dict[str, int] = {}
        for r in records or []:
            et = (r.get("evidence_type") or "mixed").strip().lower() or "mixed"
            counts[et] = counts.get(et, 0) + 1
        if not counts:
            return "mixed"
        return max(counts.items(), key=lambda kv: kv[1])[0]

    def _sanitize_row(row: dict, gold_theme: str, evidence_type: str) -> dict:
        import hashlib as _hash

        def _as_text(v):
            if isinstance(v, str):
                return v
            if v is None:
                return ""
            return json.dumps(v, ensure_ascii=False)

        pt = row.get("potential_theme")
        if not isinstance(pt, str) or not pt.strip():
            pts = row.get("potential_themes")
            if isinstance(pts, list) and pts:
                pt = (pts[0] or "").strip()
        if not isinstance(pt, str) or not pt.strip():
            t0 = row.get("theme")
            pt = (t0 or "").strip()
            if pt == gold_theme or not pt:
                pt = "(unspecified)"

        dqid = row.get("direct_quote_id")
        if not isinstance(dqid, str) or not dqid.strip():
            anchor = (
                _as_text(row.get("direct_quote"))
                or _as_text(row.get("paraphrase"))
                or _as_text(row.get("researcher_comment"))
                or ""
            ).strip()
            dqid = _hash.md5(
                f"{row.get('item_key', '')}||{anchor}".encode("utf-8")
            ).hexdigest()[:10]

        return {
            "item_key": row.get("item_key"),
            "direct_quote": _as_text(row.get("direct_quote")),
            "paraphrase": strip_rq_refs(_as_text(row.get("paraphrase"))),
            "researcher_comment": strip_rq_refs(_as_text(row.get("researcher_comment"))),
            "evidence_type": (row.get("evidence_type") or evidence_type or "mixed"),
            "direct_quote_id": dqid,
            "theme": pt,
        }

    def _prepare_job_fields(job):
        md = job.get("metadata", {}) or {}

        rq_val = (md.get("layer2_key") or job.get("rq_question") or "").strip()
        if not rq_val:
            rq_val = "(no RQ)"

        gold_theme = (
            md.get("theme_label")
            or job.get("theme")
            or "(merged_small_themes)"
        )
        gold_theme = (gold_theme or "").strip() or "(merged_small_themes)"

        route_label = (md.get("layer_structure") or job.get("route") or "fallback")
        route_label = route_label.strip() or "fallback"
        route_value = (
            md.get("route_value")
            or job.get("route_value")
            or md.get("date_range")
            or ""
        ).strip()

        ev_type_raw = (job.get("evidence_type") or "").strip()
        if not ev_type_raw:
            ev_type_raw = _majority_evidence_type(job.get("payloads", []) or [])
        evidence_type = ev_type_raw or "mixed"

        potential_theme = (
            job.get("potential_theme")
            or md.get("potential_theme")
            or "(unspecified)"
        )

        return {
            "rq_val": rq_val,
            "gold_theme": gold_theme,
            "route_label": route_label,
            "route_value": route_value,
            "evidence_type": evidence_type,
            "potential_theme": potential_theme,
        }

    def _prompt_text_for_job(job_fields, job, prompt_str: str) -> str:
        if isinstance(job.get("prompt"), str) and job["prompt"].strip():
            return job["prompt"].strip()

        if isinstance(prompt_str, str) and prompt_str.strip():
            return prompt_str.strip()

        rq_val = job_fields["rq_val"]
        gold_theme = job_fields["gold_theme"]
        evidence_type = job_fields["evidence_type"]

        tpl = PYR_L1_PROMPT if isinstance(PYR_L1_PROMPT, str) else ""
        balanced = tpl.count("{") == tpl.count("}")
        has_keys = (
            "{research_question}" in tpl
            and "{overarching_theme}" in tpl
            and "{evidence_type}" in tpl
        )
        if balanced and has_keys:
            return tpl.format(
                research_question=rq_val,
                overarching_theme=gold_theme,
                evidence_type=evidence_type,
            )

        return (
            'You are drafting a section entitled "{rq}" within the subsection "{theme}", '
            'focusing specifically on evidence type "{etype}".'
        ).format(
            rq=rq_val,
            theme=gold_theme,
            etype=evidence_type,
        )

    prompt_key_pyr_l1 = "pyr_l1_html"

    results_round1_logs: List[Dict[str, Any]] = []
    round1_sections_merged: List[Dict[str, Any]] = []

    def _run_file_group(
        coll_base: str,
        coll_suffix: str,
        jobs_for_file: Iterable[tuple[Dict[str, Any], str]],
    ) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
        def _log_line(msg: str) -> None:
            if callable(progress_cb):
                progress_cb(msg)

        def _pct(val: int) -> None:
            if callable(percent_cb):
                percent_cb(val)

        def _stable_base_sans_time(s: str) -> str:
            """
            ###1. strip run_YYYYMMDD_HHMMSS_
            ###2. ensure single 'run_' prefix
            ###3. collapse underscores and trim
            """
            import re
            v = (s or "").strip()
            v = re.sub(r"^run_\d{8}_\d{6}_", "run_", v)
            if not v.startswith("run_"):
                v = "run_" + v
            v = re.sub(r"_+", "_", v)
            return v.rstrip("_")

        jobs_list_local = list(jobs_for_file)
        first_meta = (jobs_list_local[0][0].get("metadata") or {}) if jobs_list_local else {}
        suffix_override = first_meta.get("collection_suffix") or coll_suffix
        base_norm = _stable_base_sans_time(str(coll_base))
        collection = f"{base_norm}_{suffix_override}"
        jobs_for_file = jobs_list_local

        outputs_log_local: List[Dict[str, Any]] = []
        round1_sections_local: List[Dict[str, Any]] = []
        queued_jobs: List[Dict[str, Any]] = []

        for job, prompt_str in jobs_for_file:
            payloads: List[Dict[str, Any]] = job.get("payloads", []) or []
            fields: Dict[str, Any] = _prepare_job_fields(job)

            rq_val = fields["rq_val"]
            gold_theme = fields["gold_theme"]
            potential_theme = fields["potential_theme"]
            evidence_type = fields["evidence_type"]
            route_label = fields["route_label"]
            route_value = fields.get("route_value") or ""
            cleaned_payloads: List[Dict[str, Any]] = []
            score_counts: Dict[str, int] = {}

            for r in payloads:
                if isinstance(r, dict):
                    sb = r.get("score_bucket")
                    if isinstance(sb, (int, str)):
                        sbs = str(sb).strip()
                        if sbs:
                            score_counts[sbs] = score_counts.get(sbs, 0) + 1
                    r2 = {k: v for k, v in r.items() if k not in ("relevance_score", "score_bucket")}
                    if (
                        ("direct_quote_id" not in r2)
                        or (not isinstance(r2["direct_quote_id"], str))
                        or (not r2["direct_quote_id"].strip())
                    ):
                        import hashlib as _hash
                        anchor = (
                            r2.get("direct_quote")
                            or r2.get("paraphrase")
                            or r2.get("researcher_comment")
                            or ""
                        ).strip()
                        base_hash = f'{r2.get("item_key", "")}||{anchor}'
                        r2["direct_quote_id"] = _hash.md5(base_hash.encode("utf-8")).hexdigest()[:10]
                    cleaned_payloads.append(r2)

            payload_for_llm = [_sanitize_row(r, gold_theme, evidence_type) for r in cleaned_payloads]
            final_prompt_text = _prompt_text_for_job(fields, job, prompt_str)

            req_input = "PROMPT:\n" + final_prompt_text + "\n\nPAYLOAD(JSON):\n" + json.dumps(
                payload_for_llm, ensure_ascii=False, separators=(",", ":")
            )

            idx_val = _next_index()
            index_key = "idx_" + str(idx_val).zfill(5)
            cid_hashed = _make_custom_index_keys(req_input, idx_val)

            existing_meta = job.get("metadata") if isinstance(job.get("metadata"), dict) else {}
            existing_raw = job.get("cid") or job.get("custom_id") or existing_meta.get("custom_id")
            existing_str = existing_raw.strip() if isinstance(existing_raw, str) else ""

            cid = existing_str if existing_str else cid_hashed

            print(
                "[R1 DEBUG ENQUEUE] collection=",
                collection,
                "cid=",
                cid,
                "index_key=",
                index_key,
            )

            _log_line(
                "[ENQUEUE R1] "
                + cid
                + " | index_key="
                + index_key
                + " | collection="
                + collection
                + " | payloads="
                + str(len(payload_for_llm))
                + " | rq='"
                + rq_val
                + "' | theme='"
                + gold_theme
                + "' | type='"
                + evidence_type
                + "'"
            )

            _ = call_models_old_backin(
                text=req_input,
                function=prompt_key_pyr_l1,
                custom_id=cid,
                collection_name=collection,
                read=False,
                store_only=True,
                ai=os.getenv("OPENAI_AI_PROVIDER", "openai"),
            )

            md_local = existing_meta if isinstance(existing_meta, dict) else {}
            layer1_key_val = (md_local.get("layer1_key") or "").strip()
            md_local["custom_id"] = cid
            md_local["index_key"] = index_key

            queued_jobs.append(
                {
                    "cid": cid,
                    "index_key": index_key,
                    "rq": rq_val,
                    "gold_theme": gold_theme,
                    "potential_theme": potential_theme,
                    "evidence_type": evidence_type,
                    "route": route_label,
                    "route_value": route_value or layer1_key_val,
                    "layer1_key": layer1_key_val,
                    "score_counts": score_counts,
                    "metadata": md_local,
                }
            )

        _log_line(
            "[QUEUE] total submitted for "
            + collection
            + ": "
            + str(len(queued_jobs))
        )

        _ = _process_batch_for(
            function=prompt_key_pyr_l1,
            collection_name=collection,
            wait=True,
            download_if_ready=True,
        )

        pbar = tqdm(
            total=len(queued_jobs),
            desc="Round-1: read & postprocess (" + collection + ")",
            dynamic_ncols=True,
            disable=callable(progress_cb),
        )

        total_jobs = len(queued_jobs)
        done_jobs = 0

        if callable(progress_cb):
            progress_cb(
                "[R1] Reading & postprocessing "
                + str(total_jobs)
                + " job(s) for "
                + collection
                + "…"
            )

        for q in queued_jobs:
            cid = q["cid"]
            rq_val = q["rq"]
            gold_theme = q["gold_theme"]
            potential_theme = q["potential_theme"]
            evidence_type = q["evidence_type"]
            route_label = q["route"]
            score_counts = q["score_counts"]
            route_value = q.get("route_value") or q.get("layer1_key") or ""

            if callable(progress_cb):
                progress_cb(
                    "[READ R1] "
                    + cid
                    + " | collection="
                    + collection
                    + " ("
                    + str(done_jobs)
                    + "/"
                    + str(total_jobs)
                    + ")"
                )

            resp_obj = call_models_old_backin(
                text="",
                function=prompt_key_pyr_l1,
                custom_id=cid,
                collection_name=collection,
                read=True,
                store_only=False,
            )

            html_raw = _extract_html(resp_obj)

            html_proc = postprocess_html_with_quotes_and_apa(
                html_raw,
                direct_quote_lookup=direct_quote_lookup,
                df=df,

            )

            meta_combined = dict(q.get("metadata") or {})
            meta_combined.update(
                {
                    "custom_id": cid,
                    "index_key": q.get("index_key"),
                    "rq": rq_val,
                    "gold_theme": gold_theme,
                    "potential_theme": potential_theme,
                    "evidence_type": evidence_type,
                    "route": route_label,
                    "route_value": route_value,
                }
            )

            round1_sections_local.append(
                {
                    "meta": meta_combined,
                    "section_html": html_proc,
                }
            )

            outputs_log_local.append(
                {
                    "custom_id": cid,
                    "index_key": q.get("index_key"),
                    "rq": rq_val,
                    "gold_theme": gold_theme,
                    "potential_theme": potential_theme,
                    "evidence_type": evidence_type,
                    "route": route_label,
                    "size": sum(score_counts.values()) if score_counts else None,
                    "score_buckets": score_counts,
                }
            )

            done_jobs = done_jobs + 1
            pbar.update(1)

            if callable(percent_cb) and total_jobs > 0:
                percent_cb(int(done_jobs * 100 // total_jobs))

        pbar.close()

        if callable(progress_cb):
            progress_cb(
                "[R1] Done read & postprocess for "
                + collection
                + ". ("
                + str(done_jobs)
                + "/"
                + str(total_jobs)
                + ")"
            )

        return outputs_log_local, round1_sections_local

    cache_round1 = True
    used_round1_cache = False

    cache_dir = getattr(batch, "out_dir", ".")
    if not isinstance(cache_dir, str) or not cache_dir.strip():
        cache_dir = "."

    os.makedirs(cache_dir, exist_ok=True)

    raw_name = collection_name if isinstance(collection_name, str) and collection_name.strip() else "collection"
    safe_name = raw_name.replace(os.sep, "_")

    expected_sections = 0
    if getattr(batch, "planned_files", None):
        for suffix, jobs_for_file in batch.planned_files:
            if isinstance(jobs_for_file, list):
                expected_sections = expected_sections + len(jobs_for_file)

    if cache_round1 and os.path.isdir(cache_dir):
        cache_candidates = []
        prefix = safe_name + "_"
        for name in os.listdir(cache_dir):
            if name.endswith(".json") and name.startswith(prefix):
                cache_candidates.append(os.path.join(cache_dir, name))

        if cache_candidates:
            latest_cache = max(cache_candidates, key=os.path.getmtime)
            with open(latest_cache, "r", encoding="utf-8") as f:
                data = json.load(f)

            cached_logs = data.get("results_round1_logs")
            cached_sections = data.get("round1_sections_merged")

            accept_cache = False
            if isinstance(cached_logs, list) and isinstance(cached_sections, list):
                if expected_sections > 0:
                    if len(cached_sections) >= expected_sections:
                        accept_cache = True
                else:
                    accept_cache = True

            if accept_cache:
                results_round1_logs = cached_logs
                round1_sections_merged = cached_sections
                used_round1_cache = True
                if callable(progress_cb):
                    progress_cb(
                        "[R1 CACHE] loaded "
                        + str(len(round1_sections_merged))
                        + " sections from "
                        + latest_cache
                    )
            else:
                if callable(progress_cb):
                    progress_cb(
                        "[R1 CACHE] ignored "
                        + latest_cache
                        + " (cached_sections="
                        + str(len(cached_sections) if isinstance(cached_sections, list) else 0)
                        + ", expected_sections="
                        + str(expected_sections)
                        + ")"
                    )

    if (not used_round1_cache) and batch.planned_files:
        with ThreadPoolExecutor(max_workers=min(32, len(batch.planned_files))) as exe:
            futures = [
                exe.submit(
                    _run_file_group,
                    collection_name,
                    suffix,
                    jobs_for_file,
                )
                for (suffix, jobs_for_file) in batch.planned_files
            ]
            for fut in as_completed(futures):
                outs, secs = fut.result()
                results_round1_logs.extend(outs)
                round1_sections_merged.extend(secs)

        if cache_round1 and os.path.isdir(cache_dir):
            count = len(round1_sections_merged)
            cache_name = safe_name + "_" + str(count) + ".json"
            cache_path = os.path.join(cache_dir, cache_name)
            with open(cache_path, "w", encoding="utf-8") as f:
                json.dump(
                    {
                        "results_round1_logs": results_round1_logs,
                        "round1_sections_merged": round1_sections_merged,
                    },
                    f,
                    ensure_ascii=False,
                )
            if callable(progress_cb):
                progress_cb(
                    "[R1 CACHE] wrote "
                    + str(count)
                    + " sections to "
                    + cache_path
                )

    setattr(batch, "pyr_global_index_counter", cid_index_counter)
    return results_round1_logs, round1_sections_merged


def process_rq_theme_claims(
    collection_name: str,
    top_n_per_score: int | None = None,
    score_key_format: str = "int",
    dir_base: str = r"C:\Users\luano\PycharmProjects\Back_end_assis\thematics_outputs",
    df: Any = None,
    manifest_path: str | None = None,  # allow passing manifest directly
    use_round1_cache: bool = True,     # skip recompute of direct_quote_lookup & quote_hits if present
    *,
    # Modal-driven inputs (preferred path)
    ai_modal_result: dict | None = None,   # extended_printable from _on_ai_modal_confirm
    grouped_payload: dict | None = None,   # output of grouping_widget_data(...)
    batch_plan: dict | None = None,        # output of batching_widget_data(...)
) -> dict:
    """
    If modal dicts are provided, we build outputs under:
      {dir_base}/{primary_filter_folder}/{filters_slug}__{dates_slug}_{MM-DD}/
    where primary_filter_folder = RQ (if any) else Authors (if any) else 'all'.

    Otherwise, falls back to legacy manifest-driven path using batching_claims(...).
    """

    def _coerce_to_dict(x: Any) -> dict:
        if x is None:
            return {}
        for attr in ("model_dump", "dict"):
            fn = getattr(x, attr, None)
            if callable(fn):
                try:
                    return fn()
                except Exception:
                    pass
        return x if isinstance(x, dict) else dict(x)

    def _slug(s: str, maxlen: int = 80) -> str:
        s = (s or "").strip()
        if not s:
            return "all"
        s = s.replace("/", " ").replace("\\", " ").replace("|", " ").replace(":", " ")
        s = re.sub(r"\s+", "-", s)
        s = re.sub(r"[^A-Za-z0-9._\-]+", "", s)
        s = s.strip("-_.")
        return (s or "all")[:maxlen]

    def _vals_list(v: Any) -> List[str]:
        if v is None:
            return []
        if isinstance(v, str):
            return [v] if v.strip() else []
        if isinstance(v, (list, tuple, set)):
            return [str(x) for x in v if str(x).strip()]
        return []

    def _filters_slug(modal_filters: dict) -> str:
        if not isinstance(modal_filters, dict):
            return "all"
        parts: List[str] = []
        for key in ("rq", "theme", "evidence_type", "authors", "years"):
            vals = _vals_list(modal_filters.get(key))
            if vals:
                head = ",".join(_slug(x, 24) for x in vals[:2])
                parts.append(f"{key}={head}" if head else key)
        return _slug("__".join(parts) if parts else "all", 120)

    def _dates_slug(dates_str: str | None) -> str:
        if not dates_str:
            return "no-dates"
        s = dates_str.strip()
        if not s or s.lower() == "none":
            return "no-dates"
        return _slug(s.replace(",", "_").replace(";", "_"), 120)

    def _primary_folder(filters_dict: dict) -> str:
        """Pick a safe, human-readable primary folder from filters:
        prefer single RQ, else single Author, else 'all'."""
        rqs = _vals_list(filters_dict.get("rq"))
        if rqs:
            return f"rq__{_slug(rqs[0], 80) if len(rqs)==1 else 'multi'}"
        authors = _vals_list(filters_dict.get("authors"))
        if authors:
            return f"authors__{_slug(authors[0], 80) if len(authors)==1 else 'multi'}"
        return "all"

    # -------------------- Legacy manifest-driven path --------------------
    if ai_modal_result is None and grouped_payload is None and batch_plan is None:
        batch = batching_claims(
            collection_name=collection_name,
            top_n_per_score=top_n_per_score,
            score_key_format=score_key_format,
            dir_base=dir_base,
            df=df,
            manifest_path=manifest_path,
            use_round1_cache=use_round1_cache,
        )
        rounds = running_rounds(
            collection_name=collection_name,
            df=df,
            batch=batch,
        )
        payload: Dict[str, Any] = {
            "collection_name": collection_name,
            "out_dir": batch.out_dir,
            "manifest_path": getattr(batch, "manifest_path", manifest_path),
            "num_batches": len(batch.planned_files),
            "submitted": True,
            "read_ok": True,
            "outputs": rounds.outputs_round1,
            "round1_sections": rounds.round1_sections_merged,
            "num_batches_round2": rounds.num_batches_round2,
            "custom_ids_round2": rounds.custom_ids_round2,
            "outputs_round2": rounds.outputs_round2,
            "export_paths": rounds.export_paths,
        }
        try:
            return _ReturnSchema(**payload).model_dump()
        except Exception:
            return payload

    # -------------------- Modal-driven path ------------------------------
    modal = _coerce_to_dict(ai_modal_result)
    grouped_payload = _coerce_to_dict(grouped_payload)
    batch_plan = _coerce_to_dict(batch_plan)

    filters_dict = modal.get("filters", {})
    dates_str = modal.get("dates") or grouped_payload.get("dates") or ""

    primary_dir = _primary_folder(filters_dict)
    filters_dir = _filters_slug(filters_dict)
    dates_dir = _dates_slug(dates_str)
    today_dir = datetime.now().strftime("%m-%d")

    out_dir = Path(dir_base) / primary_dir / f"{filters_dir}__{dates_dir}_{today_dir}"
    out_dir.mkdir(parents=True, exist_ok=True)

    # Persist inputs/artifacts for provenance
    try:
        (out_dir / "inputs").mkdir(exist_ok=True)
        with open(out_dir / "inputs" / "AI_MODAL_RESULT.json", "w", encoding="utf-8") as f:
            json.dump(modal, f, ensure_ascii=False, indent=2)
        with open(out_dir / "inputs" / "GROUPED.json", "w", encoding="utf-8") as f:
            json.dump(grouped_payload, f, ensure_ascii=False, indent=2)
        with open(out_dir / "inputs" / "AI_BATCHES.json", "w", encoding="utf-8") as f:
            json.dump(batch_plan, f, ensure_ascii=False, indent=2)
    except Exception:
        pass

    # Build planned_files structure for running_rounds
    batches_list: List[dict] = list(batch_plan.get("batches", []) or [])
    jobs_by_l1: Dict[str, List[Tuple[dict, str]]] = defaultdict(list)
    for job in batches_list:
        md = job.get("metadata", {}) or {}
        l1_key = md.get("layer1_key") or "all"
        suffix = _slug(str(l1_key), 64)
        prompt_str = (job.get("prompt") or job.get("analysis_prompt") or job.get("writer_prompt") or "").strip()
        jobs_by_l1[suffix].append((job, prompt_str))
    planned_files: List[Tuple[str, List[Tuple[dict, str]]]] = list(jobs_by_l1.items())

    # Build caches required by post-processing
    direct_quote_lookup: Dict[str, dict] = {}
    from collections import defaultdict as _dd
    quote_hits: Dict[str, int] = _dd(int)

    def _ensure_dqid(rec: dict) -> str:
        dqid = rec.get("direct_quote_id")
        if isinstance(dqid, str) and dqid.strip():
            return dqid
        import hashlib as _hash
        anchor = (rec.get("direct_quote") or rec.get("paraphrase") or rec.get("researcher_comment") or "").strip()
        base = f"{rec.get('item_key', '')}||{anchor}"
        dqid = _hash.md5(base.encode("utf-8")).hexdigest()[:10]
        rec["direct_quote_id"] = dqid
        return dqid

    for _, lst in planned_files:
        for job, _ps in lst:
            for r in (job.get("payloads") or []):
                if not isinstance(r, dict):
                    continue
                dqid = _ensure_dqid(r)
                if dqid not in direct_quote_lookup:
                    direct_quote_lookup[dqid] = {
                        "item_key": r.get("item_key"),
                        "author_summary": r.get("author_summary"),
                        "first_author_last": r.get("first_author_last"),
                        "year": r.get("year"),
                        "title": r.get("title"),
                        "source": r.get("source"),
                        "url": r.get("url"),
                        "page": r.get("page"),
                        "section_title": r.get("section_title"),
                        "section_text": r.get("section_text"),
                        "theme": r.get("theme") or r.get("potential_theme"),
                    }
                ik = r.get("item_key")
                if isinstance(ik, str) and ik.strip():
                    quote_hits[ik] += 1

    # Save caches

    with open(out_dir / "direct_quote_lookup.json", "w", encoding="utf-8") as f:
            json.dump(direct_quote_lookup, f, ensure_ascii=False, indent=2)
    with open(out_dir / "quote_hits.json", "w", encoding="utf-8") as f:
            json.dump(quote_hits, f, ensure_ascii=False, indent=2)


    # Minimal artifacts namespace for running_rounds
    all_jobs_flat: List[dict] = [job for _, lst in planned_files for (job, _ps) in lst]
    batch_ns = SimpleNamespace(
        planned_files=planned_files,
        direct_quote_lookup=direct_quote_lookup,
        quote_hits=quote_hits,
        out_dir=str(out_dir),
        all_jobs_flat=all_jobs_flat,
        manifest_path=None,
    )

    rounds = running_rounds(
        collection_name=collection_name,
        df=df,
        batch=batch_ns,
    )

    payload: Dict[str, Any] = {
        "collection_name": collection_name,
        "out_dir": str(out_dir),
        "manifest_path": None,
        "num_batches": len(planned_files),
        "submitted": True,
        "read_ok": True,
        "outputs": rounds.outputs_round1,
        "round1_sections": rounds.round1_sections_merged,
        "num_batches_round2": rounds.num_batches_round2,
        "custom_ids_round2": rounds.custom_ids_round2,
        "outputs_round2": rounds.outputs_round2,
        "export_paths": rounds.export_paths,
    }

    try:
        return _ReturnSchema(**payload).model_dump()
    except Exception:
        return payload
PYR_L1_PROMPT = (
    "<main_instructions>\n EVIDENCE COVERAGE (mandatory)\n"
    "• Analyse every PAYLOAD(JSON) item at least once; cite when used.\n"
    "• Group claims by shared \"theme\"; note convergence or disagreement within a paragraph.\n"
    "• If any items do not fit, add one final paragraph titled \"Residual coverage\" and cite them briefly.\n\n"
    "CITATION RULES\n"
    "• ≥1 anchor per paragraph; place anchors immediately after the supported sentence.\n"
    "  <a  data-key=\"item_key\" title=\"direct_quote_id\">\"item_key\"</a>\n"
    "• When several sources support one sentence, include multiple anchors separated by semicolons.\n"
    "• Do not invent keys; never repeat the same  direct_quote_id within a single sentence.\n\n"
    "DIVERSITY\n"
    "• Aim for ≥2 distinct direct_quote_id  per thematic paragraph when available.\n"
    "• Avoid citing the same item_key in consecutive sentences unless necessary.\n\n"
    "OUTPUT (raw HTML only — no Markdown, no lists)\n"
    "• Start with:\n"
    "  <h3 id=\"section-title\">[provocative but academic title reflecting the whole section]</h3>\n"
    "• Then write N thematic paragraphs. Each paragraph MUST:\n"
    "  – be a single <p> element\n"
    "  – include data-tags with 1–3 concise tags (semicolon-separated)\n"
    "  – include at least one correctly formed anchor \n"
    "  Example:\n"
    "  <p id=\"p1\" data-tags=\"methods;scope\">Topic sentence. Evidence-led exposition …"
    "<a href=\"KEY\" data-key=\"item_key\" title=\"direct_quote_id\">\"item_key\"</a>; "
    "<a href=\"KEY2\" data-key=\"item_key_2\" title=\"direct_quote_id_2\"></a>\"item_key\"</p>\n"
    "• Add a conclusive paragraph (2–3 sentences) with EXACT id:\n"
    "  <p id=\"conclusion\">Synthesis across paragraphs; state strongest regularities, salient disagreements, and implications.</p>\n"
    "• If needed, append a residuals paragraph with EXACT id:\n"
    "  <p id=\"residual\">Residual coverage: brief reason these items do not fit; still cite them with anchors.</p>\n"
    "• Finally append a coverage ledger comment:\n"
    "  <!-- coverage used=[comma-separated item_keys used] unused=[comma-separated item_keys not used] -->\n\n"
    "QUALITY CHECK (apply before returning)\n"
    "• Every paragraph has ≥1 anchor \n"
    "• Each <p> includes data-tags with 1–3 informative tags.\n"
    "• Each paragraph contains 100–150 words: topic sentence, evidence-led development with anchors, and a linking/concluding sentence.\n"
    "• No invented keys; anchors match payload items; no duplicate (item_key, direct_quote_id) within a sentence.\n"
    "• Exactly one <h3 id=\"section-title\">, one <p id=\"conclusion\">, and optional <p id=\"residual\">.\n"
    "• Coverage ledger reflects actual anchors: unused = payload_keys − used.\n<main_instructions/>\n"
)


def _score_bucket(relevance_score: int) -> str:
    try:
        s = int(relevance_score)
    except Exception:
        return "scores_3_2_1"
    return "scores_5_4" if s >= 4 else "scores_3_2_1"
def regroup_evidence_by_rq_theme_type_score(
    results_by_item: Dict[str, Dict[str, Any]],
    *,
    key_by_index: bool = False,                # default to question text (safer)
    top_n_per_score: int | None = None,
    score_key_format: str = "int",
    known_rqs: List[str] | None = None,        # ← pass manifest RQ list (exact text)
) -> Dict:
    """
    Build a pseudo-gold grouping from in-memory results_by_item.

    Output structure:
      groups[ rq_label ][ "NA" ][ potential_theme ][ evidence_type ][ score_bucket ] -> [records]

    Notes:
      - Prefers question text over raw indices.
      - If `known_rqs` is provided, only those labels are allowed; unknown indices/questions are dropped.
      - Prevents phantom folders like 'rq_5_*' when legacy/stale indices appear.
      - Propagates per-evidence `gold_theme` when present, so later stages can infer/merge with true gold.
    """
    import re

    def _norm(s: str) -> str:
        return re.sub(r"\s+", " ", (s or "").strip().lower())

    # Build a validator map if `known_rqs` is given
    known_map = {}
    if isinstance(known_rqs, list) and known_rqs:
        known_map = {_norm(q): q for q in known_rqs}
        idx_to_q = {i: q for i, q in enumerate(known_rqs)}
    else:
        idx_to_q = {}

    SYNTH_GOLD = "(evidence grouped)"
    groups: Dict = {}

    def _score_bucket(score, fmt: str = "int") -> str:
        try:
            if score is None:
                return "5"
            val = int(score)
            if fmt == "label":
                return {5: "HIGH", 4: "MED", 3: "LOW"}.get(val, str(val))
            return str(val)
        except Exception:
            return "5"

    def _ensure_list(x):
        if x is None:
            return []
        if isinstance(x, list):
            return x
        return [x]

    def _emit(rq_label: str, ptheme: str, etype: str, score_bucket_key: str, record: dict):
        groups.setdefault(rq_label, {}) \
              .setdefault(SYNTH_GOLD, {}) \
              .setdefault(ptheme, {}) \
              .setdefault(etype, {}) \
              .setdefault(score_bucket_key, []) \
              .append(record)

    for item_key, blob in (results_by_item or {}).items():
        evs = (blob or {}).get("evidence_list") or []
        for ev in evs:
            etype = (ev.get("evidence_type") or "unspecified").strip()
            score_bucket_key = _score_bucket(ev.get("relevance_score"), fmt=score_key_format)

            pthemes = ev.get("potential_themes")
            if isinstance(pthemes, str) and pthemes.strip():
                pthemes = [pthemes.strip()]
            if not pthemes:
                pthemes = [(ev.get("potential_theme") or "").strip() or "(unspecified)"]

            # Normalized RQ labels (validated)
            rqs = _ensure_list(ev.get("relevant_rqs"))
            rq_labels: List[str] = []

            for rq in rqs:
                # dict style {index, question}
                if isinstance(rq, dict):
                    q_text = (rq.get("question") or "").strip()
                    idx = rq.get("index")

                    if q_text:
                        qn = _norm(q_text)
                        if known_map:
                            if qn in known_map:
                                rq_labels.append(known_map[qn])
                            else:
                                continue
                        else:
                            rq_labels.append(q_text)
                        continue

                    if isinstance(idx, int):
                        if idx_to_q:
                            if idx in idx_to_q:
                                rq_labels.append(idx_to_q[idx])
                            else:
                                continue
                        else:
                            if key_by_index:
                                rq_labels.append(f"rq:{idx}")
                            else:
                                continue

                # plain string (already a question)
                elif isinstance(rq, str) and rq.strip():
                    q_text = rq.strip()
                    qn = _norm(q_text)
                    if known_map:
                        if qn in known_map:
                            rq_labels.append(known_map[qn])
                        else:
                            continue
                    else:
                        rq_labels.append(q_text)

            if not rq_labels:
                continue

            # Build record and PROPAGATE gold theme if present on evidence
            rec_base = {
                "item_key": item_key,
                "direct_quote": ev.get("direct_quote"),
                "paraphrase": ev.get("paraphrase"),
                "researcher_comment": ev.get("researcher_comment"),
                "potential_theme": None,  # set below
                "evidence_type": etype,
                "relevance_score": ev.get("relevance_score"),
                "gold_theme": ev.get("gold_theme"),  # <-- propagate gold title for later inference
            }

            for ptheme in pthemes:
                ptheme = (ptheme or "").strip() or "(unspecified)"
                for rq_label in rq_labels:
                    rec2 = dict(rec_base)
                    rec2["potential_theme"] = ptheme
                    _emit(rq_label, ptheme, etype, score_bucket_key, rec2)

    # optional top-N per score bucket
    if isinstance(top_n_per_score, int) and top_n_per_score > 0:
        for rq, gmap in list(groups.items()):
            for gold, pmap in list(gmap.items()):
                for ptheme, etmap in list(pmap.items()):
                    for etype, sbmap in list(etmap.items()):
                        for sb, lst in list(sbmap.items()):
                            if len(lst) > top_n_per_score:
                                sbmap[sb] = lst[:top_n_per_score]

    return groups
def regroup_evidence_by_rq_theme_type_score_from_rbi(
    results_by_item_path: str | None,
    top_n_per_score: int | None = None,
    score_key_format: str = "int",
) -> dict:
    """
    Build GOLD-aware groups from results_by_item, but ensure we emit
    each (RQ label, GOLD title, item_key, direct_quote_id) at most once.

    Diagnostics:
      - Prints a compact report of suppressed duplicates and why they occurred.
    """
    import json, os, re, hashlib
    from collections import defaultdict, Counter

    if not results_by_item_path or not os.path.isfile(results_by_item_path):
        return {}

    with open(results_by_item_path, "r", encoding="utf-8") as f:
        data = json.load(f) or {}

    # ---------------- normalize helpers ----------------
    ET_ALLOWED = {
        "finding","claim","limitation","example","method","framework",
        "policy_position","recommendation","quote","anecdote","evidence","mixed"
    }

    def _norm_etype(s) -> str:
        s = (str(s or "")).strip().lower()
        return s if s in ET_ALLOWED else "mixed"

    def _score_bucket(score) -> str:
        try:
            v = int(float(score))
        except Exception:
            v = 5
        v = max(1, min(5, v))
        if score_key_format == "int":
            return str(v)
        return "high" if v >= 5 else ("medium" if v >= 3 else "low")

    def _norm_q(s: str) -> str:
        s = " ".join((s or "").split())
        return s.strip(' \t\n\r"“”\'‘’.,;:')

    def _idx_to_label(md: dict) -> dict[int, str]:
        out = {}
        for ln in (md or {}).get("rq_lines") or []:
            if not isinstance(ln, str):
                continue
            m = re.match(r"\s*(\d+)\s*:\s*(.+)$", ln.strip())
            if m:
                out[int(m.group(1))] = _norm_q(m.group(2))
        return out

    def _ensure_list(x):
        if x is None:
            return []
        if isinstance(x, list):
            return x
        return [x]

    def _mint_dqid(item_key: str, ev: dict) -> str:
        anchor = (ev.get("direct_quote") or ev.get("paraphrase") or ev.get("researcher_comment") or "").strip()
        base = f"{item_key}||{anchor}"
        return hashlib.md5(base.encode("utf-8")).hexdigest()[:10]

    # ---------------- discover GOLD (themes_only) ----------------
    dir_path = os.path.dirname(results_by_item_path)
    themes_only_paths = []

    man_path = os.path.join(dir_path, "manifest.json")
    if os.path.isfile(man_path):
        try:
            with open(man_path, "r", encoding="utf-8") as mf:
                m = json.load(mf) or {}
            p = m.get("paths") or {}
            for k in ("hydrated_only", "themes_only"):
                v = p.get(k)
                if isinstance(v, str) and os.path.isfile(v):
                    themes_only_paths.append(v)
        except Exception:
            pass

    if not themes_only_paths:
        for fn in os.listdir(dir_path):
            if fn.endswith("_themes_only.json"):
                themes_only_paths.append(os.path.join(dir_path, fn))

    gold_id_to_title: dict[str, str] = {}
    theme_id_to_gold_title: dict[str, str] = {}
    item_key_votes: dict[str, Counter] = defaultdict(Counter)

    for tf in themes_only_paths:
        try:
            with open(tf, "r", encoding="utf-8") as f:
                slim = json.load(f) or {}
        except Exception:
            continue
        gold_id_to_title.update(dict(slim.get("gold_theme_map") or {}))
        hyd = slim.get("hydrated_assignments") or {}
        if not isinstance(hyd, dict):
            continue
        for gid, buckets in hyd.items():
            gold_title = gold_id_to_title.get(gid, gid)
            for b in (buckets or []):
                if not isinstance(b, dict):
                    continue
                tid = (b.get("theme_id") or "").strip()
                if tid:
                    theme_id_to_gold_title[tid] = gold_title
                for it in _ensure_list(b.get("items")):
                    if isinstance(it, dict):
                        ik = (it.get("item_key") or "").strip()
                        if ik:
                            item_key_votes[ik][gold_title] += 1

    item_key_to_gold = {ik: ctr.most_common(1)[0][0] for ik, ctr in item_key_votes.items() if ctr}

    # ---------------- build global RQ index→label ----------------
    idx_to_label: dict[int, str] = {}
    for _k, blob in (data or {}).items():
        md = (blob or {}).get("metadata") or {}
        for i, lab in _idx_to_label(md).items():
            idx_to_label.setdefault(i, lab)

    SYNTH_GOLD = "NA"
    groups: dict = {}

    def _emit(rq_key: str, gold_title: str, ptheme: str, etype: str, sb: str, rec: dict):
        groups.setdefault(rq_key, {}) \
              .setdefault(gold_title, {}) \
              .setdefault(ptheme, {}) \
              .setdefault(etype, {}) \
              .setdefault(sb, []) \
              .append(rec)

    # ---------------- diagnostics for duplicates ----------------
    emitted_keys = set()  # (rq_label, gold_title, item_key, direct_quote_id)
    dupe_counter = Counter()
    dupe_samples = []     # keep a few examples

    # ---------------- main loop ----------------
    for item_key, blob in (data or {}).items():
        evs = (blob or {}).get("evidence_list") or []
        # theme_id hint at the item/bundle level (rare)
        bundle_theme_id = (blob or {}).get("theme_id") or (blob or {}).get("themeId")

        for ev in evs:
            etype = _norm_etype(ev.get("evidence_type"))
            sb = _score_bucket(ev.get("relevance_score"))
            dqid = ev.get("direct_quote_id") or _mint_dqid(item_key, ev)

            # choose gold title: evidence hint > item vote > theme_id hint > synth
            gold_title = None
            ev_gold = ev.get("gold_theme")
            if isinstance(ev_gold, str) and ev_gold.strip():
                gold_title = ev_gold.strip()
            if not gold_title and item_key in item_key_to_gold:
                gold_title = item_key_to_gold[item_key]
            if not gold_title and isinstance(bundle_theme_id, str) and bundle_theme_id.strip():
                gold_title = theme_id_to_gold_title.get(bundle_theme_id.strip())
            if not gold_title:
                gold_title = SYNTH_GOLD

            # themes
            pthemes = ev.get("potential_themes")
            if isinstance(pthemes, str) and pthemes.strip():
                pthemes = [pthemes.strip()]
            if not pthemes:
                pthemes = [(ev.get("potential_theme") or "").strip() or "(unspecified)"]

            # RQ labels
            rq_keys = []
            for rq in _ensure_list(ev.get("relevant_rqs")):
                if isinstance(rq, dict):
                    idx = rq.get("index", None)
                    q = _norm_q(rq.get("question") or "")
                    if isinstance(idx, int) and idx in idx_to_label:
                        rq_keys.append(f"{idx}: {idx_to_label[idx]}")
                    elif isinstance(idx, int):
                        rq_keys.append(f"{idx}: {q or '(unlabeled RQ)'}")
                    elif q:
                        rq_keys.append(q)
                elif isinstance(rq, str) and rq.strip():
                    rq_keys.append(_norm_q(rq))
            if not rq_keys:
                continue

            # base record (we keep all_potential_themes for audit; choose first for 'potential_theme')
            pthemes_clean = [p for p in _ensure_list(pthemes) if isinstance(p, str) and p.strip()]
            chosen_ptheme = (pthemes_clean[0] if pthemes_clean else "(unspecified)")

            base = {
                "item_key": item_key,
                "direct_quote": ev.get("direct_quote"),
                "paraphrase": ev.get("paraphrase"),
                "researcher_comment": ev.get("researcher_comment"),
                "evidence_type": etype,
                "relevance_score": ev.get("relevance_score"),
                "score_bucket": sb,
                "direct_quote_id": dqid,
                "gold_theme": gold_title,
                "all_potential_themes": pthemes_clean or ["(unspecified)"],
            }

            # Emit once per (rq, gold, item_key, quote_id); suppress extras & log cause
            for rk in rq_keys:
                sig = (rk, gold_title, item_key, dqid)
                if sig in emitted_keys:
                    # Diagnose cause
                    cause = "same_ev_multiple_pthemes" if len(pthemes_clean) > 1 else "repeat_elsewhere"
                    dupe_counter[cause] += 1
                    if len(dupe_samples) < 10:
                        dupe_samples.append({
                            "rq": rk, "gold": gold_title, "item_key": item_key,
                            "direct_quote_id": dqid, "themes": pthemes_clean
                        })
                    continue

                rec = dict(base)
                rec["potential_theme"] = chosen_ptheme
                emitted_keys.add(sig)
                _emit(rk, gold_title, chosen_ptheme, etype, sb, rec)

    # cap per score bucket if requested
    if isinstance(top_n_per_score, int) and top_n_per_score > 0:
        for rq, gold_map in list(groups.items()):
            for gold, ptmap in list(gold_map.items()):
                for ptheme, etmap in list(ptmap.items()):
                    for etype, sbmap in list(etmap.items()):
                        for sb, lst in list(sbmap.items()):
                            if len(lst) > top_n_per_score:
                                sbmap[sb] = lst[:top_n_per_score]

    # --------------- diagnostics printout ---------------
    total_dupes = sum(dupe_counter.values())
    if total_dupes:
        print("[RBI→groups] Suppressed duplicate evidence rows:", total_dupes)
        for k, v in dupe_counter.items():
            print(f"  - {k}: {v}")
        if dupe_samples:
            print("[RBI→groups] dupe examples (up to 10):")
            for s in dupe_samples:
                print("   ", s)

    return groups
def batching_rq_themes_with_routes(
    groups: dict,
    *,
    batch_size: int = 20,
    overlap: int = 5,
    score: str = "fallback",  # "high" | "medium" | "medhi" | "any" | "fallback"
    layer1_mode: str = "theme",    # "temporal" | "author" | "theme"
    layer1_key: str | None = None, # e.g. "2008-2015" or "Basu and Hickok"
):
    """
    Build PYR-L1 jobs from regrouped groups:
        groups[rq_key][gold_theme][potential_theme][evidence_type][score_bucket] -> [records]

    NEW:
    - Every returned chunk now has a fully constructed `prompt` that is *not empty*.
      This prompt = contextual analysis intro (depends on layer1_mode: temporal/author/theme)
      + the strict HTML drafting / coverage instructions in PYR_L1_PROMPT.
    - We also stash that same prompt string inside the job dict as job["prompt"].

    layer1_mode / layer1_key:
      • temporal mode: layer1_key is a timeframe like "2008-2015"
      • author mode:   layer1_key is an author string
      • theme mode:    layer1_key is ignored for analysis intro; we use the gold theme per-chunk

    Still returns a list of (job_dict, prompt_string) for downstream compatibility.
    """

    import hashlib, re
    from collections import Counter
    from collections.abc import Mapping

    # Canonical evidence types
    CANON_ET = {
        "claim","limitation","example","method","framework",
        "policy_position","recommendation","quote","anecdote","evidence","mixed"
    }
    ET_SYNONYM = {
        "finding": "claim",
        "observation": "claim",
        "fact": "claim",
        "unspecified": "mixed",
        "": "mixed",
        None: "mixed",
    }

    def _norm_etype_label(s: str) -> str:
        t = (str(s or "")).strip().lower()
        t = ET_SYNONYM.get(t, t)
        return t if t in CANON_ET else "mixed"

    # strip "RQ 3, RQ4" etc. noise from paraphrase/comment
    _RQ_MENTION_RE = re.compile(
        r"""
        (                               # removable group
          \s*
          (?:\(|\[)?\s*
          (?:RQs?|research\s*questions?)\s*
          (?::|\s+)?\s*
          \d+
          (?:\s*(?:,|;|\band\b|&)\s*\d+)*
          \s*(?:\)|\])?
          \s*
        )
        """,
        re.IGNORECASE | re.VERBOSE,
    )

    def _strip_rq_mentions_in_text(s: str) -> str:
        if not isinstance(s, str):
            return s
        t = _RQ_MENTION_RE.sub(" ", s)
        t = re.sub(r"\s*(?:,|;|\band\b|&)\s*(?=[).,\];:])", "", t, flags=re.IGNORECASE)
        t = re.sub(r"([,.;:])\s*([).,;:])", r"\2", t)
        t = re.sub(r"\(\s*\)|\[\s*\]", "", t)
        t = re.sub(r"\s+([,.;:])", r"\1", t)
        t = re.sub(r"\s{2,}", " ", t).strip()
        return t

    def _score_ok(bucket: str, mode: str) -> bool:
        b = (bucket or "").strip().lower()
        if mode == "high":
            return b in ("5", "high")
        if mode == "medium":
            return b in ("3", "4", "medium")
        if mode == "medhi":
            return b in ("3", "4", "5", "medium", "high")
        return True  # "any"

    def _ensure_dqid(item: dict) -> dict:
        if not isinstance(item, dict):
            return {}
        if isinstance(item.get("direct_quote_id"), str) and item["direct_quote_id"].strip():
            return item
        anchor = (item.get("direct_quote") or item.get("paraphrase") or item.get("researcher_comment") or "").strip()
        base = f"{item.get('item_key','')}||{anchor}"
        item["direct_quote_id"] = hashlib.md5(base.encode("utf-8")).hexdigest()[:10]
        return item

    def _norm(s, default="(unspecified)"):
        s = ("" if s is None else str(s)).strip()
        return s if s else default

    def _sbucket_of(rec) -> str:
        sb = rec.get("score_bucket")
        if isinstance(sb, (int, str)) and str(sb).strip():
            return str(sb).strip()
        rs = rec.get("relevance_score")
        try:
            v = int(rs)
        except Exception:
            v = 5
        return str(max(1, min(5, v)))

    def _etype_of(rec) -> str:
        return _norm_etype_label(rec.get("evidence_type"))

    def _ptheme_of(rec, ptheme_hint=None) -> str:
        pt_raw = rec.get("potential_theme") or rec.get("potential_themes") or ""
        pt = ""
        if isinstance(pt_raw, str):
            pt = pt_raw.strip()
        elif isinstance(pt_raw, list) and pt_raw:
            pt = str(pt_raw[0] or "").strip()

        pt = pt or (ptheme_hint or "")
        return pt if pt else "(unspecified)"

    def _collect_leaf_lists(d):
        if isinstance(d, list):
            yield d
        elif isinstance(d, Mapping):
            for v in d.values():
                yield from _collect_leaf_lists(v)

    def _extract_records_from_gold(gold_map: dict | list) -> list[dict]:
        """
        For a single overarching theme (gold_theme), flatten all records under it
        into a list of dicts with ptheme/evidence_type/score_bucket filled.
        """
        out: list[dict] = []

        # Case B: {"records": [...]}
        if isinstance(gold_map, Mapping) and isinstance(gold_map.get("records"), list):
            for rec in gold_map["records"]:
                if isinstance(rec, dict):
                    r = dict(rec)
                    r["potential_theme"] = _ptheme_of(r)
                    r["evidence_type"]   = _etype_of(r)
                    r["score_bucket"]    = _sbucket_of(r)
                    _ensure_dqid(r)
                    out.append(r)
            return out

        # Case A / E: nested dict ptheme -> etype -> sbucket -> [records]
        if isinstance(gold_map, Mapping):
            def _walk(node, hints: dict):
                if isinstance(node, list):
                    for rec in node:
                        if isinstance(rec, dict):
                            r = dict(rec)
                            r["potential_theme"] = _ptheme_of(r, hints.get("ptheme"))
                            r["evidence_type"]   = _norm_etype_label(
                                r.get("evidence_type") or hints.get("etype") or "mixed"
                            )
                            r["score_bucket"]    = str(
                                r.get("score_bucket") or hints.get("sbucket") or _sbucket_of(r)
                            )
                            _ensure_dqid(r)
                            out.append(r)
                    return
                if isinstance(node, Mapping):
                    for k, v in node.items():
                        kstr = _norm(k, "")
                        if kstr in {"1","2","3","4","5","low","medium","high"}:
                            _walk(v, {**hints, "sbucket": kstr})
                        elif _norm_etype_label(kstr) in CANON_ET:
                            _walk(v, {**hints, "etype": _norm_etype_label(kstr)})
                        else:
                            _walk(v, {**hints, "ptheme": kstr})
            _walk(gold_map, {})
            if out:
                return out

        # Case C: plain list
        if isinstance(gold_map, list):
            for rec in gold_map:
                if isinstance(rec, dict):
                    r = dict(rec)
                    r["potential_theme"] = _ptheme_of(r)
                    r["evidence_type"]   = _etype_of(r)
                    r["score_bucket"]    = _sbucket_of(r)
                    _ensure_dqid(r)
                    out.append(r)
            return out

        # Fallback: walk leaves
        for lst in _collect_leaf_lists(gold_map):
            for rec in lst:
                if isinstance(rec, dict):
                    r = dict(rec)
                    r["potential_theme"] = _ptheme_of(r)
                    r["evidence_type"]   = _etype_of(r)
                    r["score_bucket"]    = _sbucket_of(r)
                    _ensure_dqid(r)
                    out.append(r)

        return out

    def _filter_by_score(recs: list[dict], mode: str) -> list[dict]:
        if mode == "any":
            return recs
        out = []
        for r in recs:
            sb = (r.get("score_bucket") or "").strip().lower()
            if _score_ok(sb, mode):
                out.append(r)
        return out

    def _flatten_with_fallback(gold_map: dict | list, requested: str):
        """
        Return (payloads, route_label) honoring fallback if requested=="fallback".
        Fallback chain: HIGH -> MED+HIGH -> ANY.
        """
        recs_all = _extract_records_from_gold(gold_map)

        if requested != "fallback":
            filtered = _filter_by_score(recs_all, requested)
            return filtered, requested.upper()

        high  = _filter_by_score(recs_all, "high")
        if high:
            return high, "HIGH"

        medhi = _filter_by_score(recs_all, "medhi")
        if medhi:
            return medhi, "MEDIUM+HIGH"

        anyr  = _filter_by_score(recs_all, "any")
        if anyr:
            return anyr, "ANY"

        return [], "EMPTY"

    def _chunk_with_overlap(items: list[dict], n: int, k: int) -> list[list[dict]]:
        """
        Sliding-window-ish chunking:
        - n is nominal chunk size
        - step is n - overlap (floor at 1)
        """
        if not n or n <= 0 or len(items) <= n:
            return [items] if items else []
        step = max(1, n - max(0, k))
        chunks = []
        i = 0
        total = len(items)
        while i < total:
            chunks.append(items[i:i + n])
            i += step
        return chunks

    def _label_for_chunk(payloads: list[dict]) -> str:
        c = Counter(_norm_etype_label(p.get("evidence_type")) for p in (payloads or []))
        if not c:
            return "mixed"
        lab, cnt = c.most_common(1)[0]
        total = sum(c.values())
        return lab if (len(c) == 1 or cnt >= 0.6 * total) else "mixed"

    # helper to build the analysis intro for this chunk
    def _build_analysis_intro(rq: str, gold_theme: str, mode: str, l1_key_val: str | None) -> str:
        """
        mode:
          - "temporal": l1_key_val is timeframe string
          - "author":   l1_key_val is author name
          - "theme":    ignore l1_key_val; we use gold_theme instead
        """
        if mode == "temporal":
            timeframe = l1_key_val or "(unspecified timeframe)"
            return analysis_prompts["temporal"].format(
                rq=rq,
                timeframe=timeframe,
            ).strip()

        if mode == "author":
            author = l1_key_val or "(unspecified author)"
            return analysis_prompts["author"].format(
                rq=rq,
                author=author,
            ).strip()

        # default: theme mode
        return analysis_prompts["theme"].format(
            rq=rq,
            theme=gold_theme or "(unspecified theme)",
        ).strip()

    jobs = []
    print("\n[DEBUG] batching start (routes) score=", repr(score))

    for rq_key, golds in (groups or {}).items():
        print(f"\n=== RQ === {rq_key}")
        rq_jobs_for_this_rq = []

        for gold_title, gold_map in (golds or {}).items():
            print(f"\n-- GOLD THEME -- {gold_title}")

            payloads, route_label = _flatten_with_fallback(gold_map, score)
            print(f"[DEBUG] SCORE ROUTE = {route_label} (payloads={len(payloads)})")

            if not payloads:
                continue

            # normalise each record in this gold theme for this RQ
            for p in payloads:
                p["rq_question"] = rq_key
                if not isinstance(p.get("gold_theme"), str) or not p["gold_theme"].strip():
                    p["gold_theme"] = gold_title
                if not isinstance(p.get("theme"), str) or not p["theme"].strip():
                    p["theme"] = _ptheme_of(p)
                p["evidence_type"] = _norm_etype_label(p.get("evidence_type"))

                if "paraphrase" in p:
                    p["paraphrase"] = _strip_rq_mentions_in_text(p["paraphrase"])
                if "researcher_comment" in p:
                    p["researcher_comment"] = _strip_rq_mentions_in_text(p["researcher_comment"])

            # break into overlapping chunks
            for chunk in _chunk_with_overlap(payloads, batch_size, overlap):
                rq_jobs_for_this_rq.append({
                    "rq_question": rq_key,
                    "theme": gold_title,          # overarching_theme / gold
                    "payloads": chunk,
                    "route": route_label,         # HIGH / MEDIUM+HIGH / ...
                    # we'll inject "prompt" later per-chunk
                })

        if not rq_jobs_for_this_rq:
            print("[DEBUG] no payloads for this RQ after all fallbacks; skipping")
            continue

        # Build final prompt for each chunk and emit
        for job in rq_jobs_for_this_rq:
            et_label = _label_for_chunk(job["payloads"])

            # analysis intro depends on layer1_mode/layer1_key
            analysis_intro = _build_analysis_intro(
                rq=job["rq_question"],
                gold_theme=job["theme"],
                mode=layer1_mode,
                l1_key_val=layer1_key,
            )

            # structural HTML drafting instructions
            drafting_block = PYR_L1_PROMPT.format(
                research_question=job["rq_question"],
                overarching_theme=job["theme"],
                evidence_type=et_label,
            )

            final_prompt = analysis_intro + "\n\n" + drafting_block

            # attach prompt to job
            job["prompt"] = final_prompt

            # debug print
            print(f"[DEBUG][emit] RQ={job['rq_question']} | GOLD={job['theme']} | MODE={layer1_mode} | ETYPE={et_label} | size={len(job['payloads'])}")

            # keep backward-compatible tuple
            jobs.append((job, final_prompt))

    return jobs




GOLD_PLACEHOLDER = "NA"

from typing import Any, Dict, List, Optional, Callable
from types import SimpleNamespace
from pathlib import Path
from pydantic import BaseModel
import json


def _slug(raw: Any, maxlen: int = 80) -> str:
    s = _to_label(raw).strip()
    if not s:
        return "all"
    s = (
        s.replace("/", " ")
        .replace("\\", " ")
        .replace("|", " ")
        .replace(":", " ")
    )
    s = re.sub(r"\s+", "-", s)
    s = re.sub(r"[^A-Za-z0-9._\-]+", "", s)
    s = s.strip("-_.")
    return (s or "all")[:maxlen]


def _vals_list(v: Any) -> List[str]:
    out: List[str] = []
    if v is None:
        return out
    if isinstance(v, str):
        s = v.strip()
        if s:
            out.append(s)
        return out
    if isinstance(v, (list, tuple, set)):
        for item in v:
            lab = _to_label(item).strip()
            if lab:
                out.append(lab)
        return out
    if isinstance(v, dict):
        lab = _to_label(v).strip()
        if lab:
            out.append(lab)
        return out
    s = str(v).strip()
    if s:
        out.append(s)
    return out


def _filters_slug(filters_dict: dict) -> str:
    if not isinstance(filters_dict, dict):
        return "all"
    parts: List[str] = []
    for key in ("rq", "theme", "evidence_type", "authors", "years"):
        vals = _vals_list(filters_dict.get(key))
        if vals:
            head = ",".join(_slug(x, 24) for x in vals[:2])
            parts.append(f"{key}={head}" if head else key)
    if not parts:
        return "all"
    joined = "__".join(parts)
    return _slug(joined, 120)
def _to_label(v: Any) -> str:
        if isinstance(v, dict):
            for k in ("label", "value", "text", "name", "title", "rq", "question"):
                if k in v and isinstance(v[k], str) and v[k].strip():
                    return v[k]
            try:
                return json.dumps(v, ensure_ascii=False)
            except Exception:
                return str(v)
        return str(v)

def _dates_slug(dates_val: Any) -> str:
    raw = dates_val if isinstance(dates_val, str) else _to_label(dates_val)
    if not raw:
        return "no-dates"
    s = raw.strip()
    if not s or s.lower() == "none":
        return "no-dates"
    s = s.replace(",", "_").replace(";", "_")
    return _slug(s, 120)
def creating_out_dir(
    dir_base: str,
    filters_dict: Dict[str, Any],
    dates_str: str,
    subfolder: str = "sections",

) -> Path:
    """Return a structured out_dir Path under dir_base/subfolder with date and filter tokens."""
    base_path = Path(dir_base)
    sections_root = base_path / subfolder
    sections_root.mkdir(parents=True, exist_ok=True)

    dates_slug_val = _dates_slug(dates_str)
    if isinstance(dates_slug_val, str) and dates_slug_val.strip() and dates_slug_val.lower() != "no-dates":
        dates_seg = dates_slug_val
    else:
        parts = [p for p in str(dates_slug_val or "").split("_") if p]
        if len(parts) >= 2:
            dates_seg = f"{parts[0]}_{parts[-1]}"
        elif parts:
            dates_seg = parts[0]
        else:
            dates_seg = "no-dates"

    authors_list = _vals_list(filters_dict.get("authors"))
    authors_seg = ""
    if authors_list:
        authors_seg = "authors=" + ",".join(_slug(a, 24) for a in authors_list[:3])

    rq_list = _vals_list(filters_dict.get("rq"))
    rq_tokens: List[str] = []
    for rq in rq_list:
        s = _slug(rq, 80)
        head = s.split("-")[0] if s else ""
        if head:
            rq_tokens.append(head)
    rq_seg = ("rq=" + ",".join(rq_tokens[:5])) if rq_tokens else ""

    filters_seg_parts = [p for p in (authors_seg, rq_seg) if p]
    filters_seg = "__".join(filters_seg_parts) if filters_seg_parts else "all"

    out_dir = sections_root / f"{dates_seg}__{filters_seg}"
    out_dir.mkdir(parents=True, exist_ok=True)
    return out_dir



def process_widget_data(
    *,
    ai_modal_result: Dict[str, Any],
    dir_base: str,
    batch_label: str,
    zotero_collection: str,
    df: Any,
    batch_size: int,
    batch_overlapping: int,
    progress_cb: Optional[Callable[[str], None]] = None,
    percent_cb: Optional[Callable[[int], None]] = None,
    framework_analysis: bool = True,
    OVERLAP_DEFAULT: int = 10,
round1_direct_quote_cache =True
) -> Dict[str, Any]:
    """
    End-to-end pipeline for the widget ("Code data" button).

    Behaviour preserved. Minimal change:
    - Builds an initial analysis preamble based on filters/dates.
    - Prepends this preamble to the user hint and forwards it unchanged through
      grouping → batching → running_rounds so BOTH rounds inherit the lens.
    """
    from pydantic import BaseModel,Field
    class PromptContext(BaseModel):
        rq: Optional[str] = Field(default=None)
        authors: List[str] = Field(default_factory=list)
        years: List[str] = Field(default_factory=list)
        dates_expr: str = Field(default="")

    def _log(s: str) -> None:
        if progress_cb:
            progress_cb(s)

    def _pct(n: int) -> None:
        if percent_cb:
            percent_cb(n)

    print("[WIDGET] ==== ai_modal_result snapshot ====")
    print("[WIDGET] keys:", list(ai_modal_result.keys()))
    print("[WIDGET] scope:", ai_modal_result.get("data_scope"))
    print("[WIDGET] dates:", ai_modal_result.get("dates"))
    print("[WIDGET] filters.keys:", list((ai_modal_result.get("filters") or {}).keys()))
    print("[WIDGET] batch_size:", ai_modal_result.get("batch_size"), " overlap:",
          ai_modal_result.get("batch_overlapping"))
    print("[WIDGET] rows.count:", len(list(ai_modal_result.get("data") or [])))
    print("[WIDGET] rows[0]:", ai_modal_result.get("data")[0] )

    rows_list = list(ai_modal_result.get("data") or [])
    if rows_list:
        first_row = rows_list[0]
        print("[WIDGET] rows[0] keys:", list(first_row))
        if "payload" in first_row:
            print("[WIDGET] rows[0]:", first_row.get("payload") )

        print("[WIDGET] payload:", first_row.get("metadata") )

    print("[WIDGET] =================================")

    _log("Grouping data…")
    _pct(10)





    def _ensure_dqid(rec: dict) -> str:
        dqid = rec.get("direct_quote_id")
        if isinstance(dqid, str) and dqid.strip():
            return dqid
        import hashlib as _hash
        anchor = (
            rec.get("direct_quote")
            or rec.get("paraphrase")
            or rec.get("researcher_comment")
            or ""
        ).strip()
        base = f"{rec.get('item_key', '')}||{anchor}"
        dqid = _hash.md5(base.encode("utf-8")).hexdigest()[:10]
        rec["direct_quote_id"] = dqid
        return dqid

    def _build_analysis_preamble(filters_dict: Dict[str, Any], dates_expr: str, use_framework: bool) -> str:
        ctx = PromptContext(
            rq=(filters_dict.get("rq") or "") if isinstance(filters_dict.get("rq"), str) else None,
            authors=_vals_list(filters_dict.get("authors")),
            years=_vals_list(filters_dict.get("years")),
            dates_expr=str(dates_expr or "").strip(),
        )
        if use_framework:
            parts: List[str] = []
            if ctx.rq:
                parts.append(f"RESEARCH QUESTION: {ctx.rq}")
            if ctx.authors:
                parts.append("AUTHOR LENS: " + ", ".join(ctx.authors[:5]))
            if ctx.years or ctx.dates_expr:
                rng = ctx.dates_expr if ctx.dates_expr else ", ".join(ctx.years[:5])
                parts.append(f"TIMEFRAME: {rng}")
            if not parts:
                parts.append("ANALYSIS LENS: theme-driven synthesis.")
            parts.append(
                "TASK: Provide an analytic synthesis grounded in the stated lens. "
                "Respect legal translatability and evidentiary credibility. Avoid speculation."
            )
            return "\n".join(parts)
        return (
            "SYSTEMATIC-REVIEW MODE: Aggregate findings across included items. "
            "Identify consistent claims, contradictions, and gaps. "
            "Flag strengths and limitations."
        )

    if not isinstance(ai_modal_result, dict):
        raise ValueError("process_widget_data: ai_modal_result must be a dict")

    filters_dict = ai_modal_result.get("filters", {}) or {}
    dates_str = ai_modal_result.get("dates") or ""
    batch_size_val = int(ai_modal_result.get("batch_size", 50))
    user_prompt_core = str(ai_modal_result.get("prompt") or "").strip()
    cards_list = list(ai_modal_result.get("data", []) or [])
    round2_mode = str(ai_modal_result.get("round2", "paragraphs")).strip().lower() or "paragraphs"
    framework_effective = bool(ai_modal_result.get("framework_analysis", framework_analysis))

    # ── process_widget_data: compose R1 prompts; include USER NOTE only when non-empty ──
    analysis_preamble = _build_analysis_preamble(filters_dict, dates_str, framework_effective).strip()
    modal_hint = user_prompt_core.strip()
    # OUTPUT_CONTRACT = ( "OUTPUT RULES:\n" "- Produce valid HTML with <p> blocks only (no lists or tables).\n" "- For each citation, insert a MINIMAL empty anchor:\n" ' <a data-key="{ZOTERO_KEY}" title="{DIRECT_QUOTE_ID}" data-quote-id="{DIRECT_QUOTE_ID}"></a>{ZOTERO_KEY}\n' "- Do NOT place {ZOTERO_KEY} inside the <a>. The anchor has NO inner text.\n" "- Do NOT include direct-quote text inside the paragraph body.\n" "- Preserve existing hyperlinks from payloads.\n" "- Add data-tags=\"tag1;tag2;…\" on each <p> when tags are inferable.\n" )

    # R1_TASK = ( "" )
    def _compose_r1_stub(emphasis: str) -> str:
        parts: List[str] = []
        if isinstance(modal_hint, str) and modal_hint.strip():
            parts.append("USER NOTE:\n" + modal_hint.strip())
        if analysis_preamble:
            parts.append(analysis_preamble)
        # parts.append(OUTPUT_CONTRACT)
        # parts.append(R1_TASK)
        if isinstance(emphasis, str) and emphasis.strip():
            parts.append(emphasis.strip())
        return "\n\n".join(parts).strip()

    route_prompts: Dict[str, str] = {
        "evidence": _compose_r1_stub(""),
        "cohere": _compose_r1_stub("Emphasis: concise synthesis."),
        "legal": _compose_r1_stub("Emphasis: legal sufficiency and admissibility."),
    }

    # Back-compat single prompt
    user_prompt_final = route_prompts["evidence"]
    print(len(cards_list))
    grouped_payload = grouping_widget_data(
        cards=cards_list,
        filters=filters_dict,
        dates=dates_str,
        batch_size=batch_size_val,
        extra_prompt=user_prompt_final,
    )


    # attach route-specific prompts so batching can pick the right one per job route
    grouped_payload["route_prompts"] = dict(route_prompts)

    batch_plan = batching_widget_data(
        grouped=grouped_payload,
        batch_size=batch_size_val,
        overlap=OVERLAP_DEFAULT,
        prompt=user_prompt_final,
        filters=filters_dict,
        dates=dates_str,
        route_prompts=route_prompts,
        framework_analysis=framework_effective,  # <- ensure prompts use the flag
    )
    _ = batch_plan


    out_dir = creating_out_dir(dir_base, filters_dict, dates_str, subfolder="sections")

    batches_list = list(batch_plan.get("batches", []) or [])
    from collections import defaultdict
    jobs_by_l1: Dict[str, List[tuple[dict, str]]] = defaultdict(list)
    for job in batches_list:
        md: Dict[str, Any] = job.get("metadata", {}) or {}
        l1_key: str = md.get("layer1_key") or "all"
        suffix: str = _slug(str(l1_key), 64)

        # Pull route prompts from the grouped payload (carried forward) or fall back to the
        # stubs we built in this function; avoid unresolved names.
        route_prompts_effective: Dict[str, str] = {}
        if isinstance(grouped_payload.get("route_prompts"), dict):
            route_prompts_effective = dict(grouped_payload["route_prompts"])
        elif isinstance(route_prompts, dict):
            route_prompts_effective = dict(route_prompts)

        # Resolve route label: prefer explicit job metadata; else infer from layer_structure; else evidence.
        route_label_raw: str = (md.get("route") or "").strip().lower()
        if not route_label_raw:
            layer_struct: str = (md.get("layer_structure") or grouped_payload.get("route") or "").strip().lower()
            if "legal" in layer_struct:
                route_label_raw = "legal"
            elif "cohere" in layer_struct:
                route_label_raw = "cohere"
            else:
                route_label_raw = "evidence"

        # Choose a route-specific prompt; fall back to evidence stub, then to our computed final prompt.
        route_prompt: str = (
                route_prompts_effective.get(route_label_raw)
                or route_prompts_effective.get("evidence")
                or user_prompt_final
        )

        # Final prompt string for this job, with safe fallbacks that exist in this scope.
        prompt_str: str = (
                job.get("analysis_prompt")
                or job.get("prompt")
                or job.get("writer_prompt")
                or route_prompt
                or batch_plan.get("prompt", "")
                or user_prompt_final
        ).strip()

        jobs_by_l1[suffix].append((job, prompt_str))

    planned_files = list(jobs_by_l1.items())
    # code for replacement
    from pydantic import BaseModel, Field

    class MetaIndexEntry(BaseModel):
        item_key: str = Field(default="")
        author_summary: str | None = Field(default=None)
        first_author_last: str | None = Field(default=None)
        year: str | int | None = Field(default=None)
        title: str | None = Field(default=None)
        source: str | None = Field(default=None)
        url: str | None = Field(default=None)

    def _first_author_last_from(author_summary: str | None) -> str | None:
        if author_summary is None:
            return None
        parts = [p.strip() for p in re.split(r"[;|]", author_summary) if p.strip()]
        if parts:
            head = parts[0]
            if "," in head:
                family = head.split(",", 1)[0].strip()
                return family if family else head.strip()
            return head
        return None

    def _norm_str(x: Any) -> str | None:
        if x is None:
            return None
        s = str(x).strip()
        return s if s else None

    def _build_meta_index_from_df(df_obj: Any) -> Dict[str, MetaIndexEntry]:
        out_index: Dict[str, MetaIndexEntry] = {}
        if not hasattr(df_obj, "columns"):
            return out_index
        cols = set(list(df_obj.columns))
        key_col = "item_key" if "item_key" in cols else ("key" if "key" in cols else None)
        if key_col is None:
            return out_index

        for _, row in df_obj.iterrows():
            k = _norm_str(row.get(key_col))
            if k is None:
                continue
            author_summary = _norm_str(row.get("author_summary")) or _norm_str(row.get("creator_summary"))
            first_author_last = _first_author_last_from(author_summary)
            year_val = _norm_str(row.get("year"))
            title_val = _norm_str(row.get("title"))
            source_val = _norm_str(row.get("source")) or _norm_str(row.get("publicationTitle"))
            url_val = _norm_str(row.get("url")) or _norm_str(row.get("landing_page")) or _norm_str(row.get("doi_url"))

            out_index[k] = MetaIndexEntry(
                item_key=k,
                author_summary=author_summary,
                first_author_last=first_author_last,
                year=year_val,
                title=title_val,
                source=source_val,
                url=url_val,
            )
        return out_index

    meta_index: Dict[str, MetaIndexEntry] = _build_meta_index_from_df(df)

    # code for replacement
    from pydantic import BaseModel, Field

    class MetaIndexEntry(BaseModel):
        item_key: str = Field(default="")
        author_summary: str | None = Field(default=None)
        first_author_last: str | None = Field(default=None)
        year: str | int | None = Field(default=None)
        title: str | None = Field(default=None)
        source: str | None = Field(default=None)
        url: str | None = Field(default=None)

    def _first_author_last_from(author_summary: str | None) -> str | None:
        if author_summary is None:
            return None
        parts = [p.strip() for p in re.split(r"[;|]", author_summary) if p.strip()]
        if parts:
            head = parts[0]
            if "," in head:
                family = head.split(",", 1)[0].strip()
                return family if family else head.strip()
            return head
        return None

    def _norm_str(x: Any) -> str | None:
        if x is None:
            return None
        s = str(x).strip()
        return s if s else None

    def _build_meta_index_from_df(df_obj: Any) -> Dict[str, MetaIndexEntry]:
        out_index: Dict[str, MetaIndexEntry] = {}
        if not hasattr(df_obj, "columns"):
            return out_index
        cols = set(list(df_obj.columns))
        key_col = "item_key" if "item_key" in cols else ("key" if "key" in cols else None)
        if key_col is None:
            return out_index

        for _, row in df_obj.iterrows():
            k = _norm_str(row.get(key_col))
            if k is None:
                continue
            author_summary = _norm_str(row.get("author_summary")) or _norm_str(row.get("creator_summary"))
            first_author_last = _first_author_last_from(author_summary)
            year_val = _norm_str(row.get("year"))
            title_val = _norm_str(row.get("title"))
            source_val = _norm_str(row.get("source")) or _norm_str(row.get("publicationTitle"))
            url_val = _norm_str(row.get("url")) or _norm_str(row.get("landing_page")) or _norm_str(row.get("doi_url"))

            out_index[k] = MetaIndexEntry(
                item_key=k,
                author_summary=author_summary,
                first_author_last=first_author_last,
                year=year_val,
                title=title_val,
                source=source_val,
                url=url_val,
            )
        return out_index

    meta_index: Dict[str, MetaIndexEntry] = _build_meta_index_from_df(df)

    # code for replacement
    from pydantic import BaseModel, Field

    class MetaIndexEntry(BaseModel):
        item_key: str = Field(default="")
        author_summary: str | None = Field(default=None)
        first_author_last: str | None = Field(default=None)
        year: str | int | None = Field(default=None)
        title: str | None = Field(default=None)
        source: str | None = Field(default=None)
        url: str | None = Field(default=None)

    def _first_author_last_from(author_summary: str | None) -> str | None:
        if author_summary is None:
            return None
        parts = [p.strip() for p in re.split(r"[;|]", author_summary) if p.strip()]
        if parts:
            head = parts[0]
            if "," in head:
                family = head.split(",", 1)[0].strip()
                return family if family else head.strip()
            return head
        return None

    def _norm_str(x: Any) -> str | None:
        if x is None:
            return None
        s = str(x).strip()
        return s if s else None

    def _clean_quote(s: Any) -> str:
        """
        Canonical quote normalisation used for BOTH:
        - building the PDF hits map (build_quote_hits_from_jobs)
        - looking up hits in process_widget_data

        ###1. coerce to str and strip
        ###2. normalise smart quotes/dashes and NBSP
        ###3. lowercase
        ###4. collapse whitespace
        ###5. peel symmetric wrappers
        ###6. trim punctuation at edges
        """
        txt = str(s or "").strip()
        if not txt:
            return ""

        replacements = {
            "“": '"',
            "”": '"',
            "‘": "'",
            "’": "'",
            "—": "-",
            "–": "-",
            "-": "-",
            "‒": "-",
            "…": ".",
            "\u00a0": " ",
            "\u00A0": " ",
            "\u200b": " ",
        }

        norm_chars: list[str] = []
        for ch in txt:
            if ch in replacements:
                norm_chars.append(replacements[ch])
            else:
                norm_chars.append(ch)
        txt = "".join(norm_chars)

        txt = txt.lower()
        txt = re.sub(r"\s+", " ", txt).strip()

        if " _strip_matching_wrappers" in globals():
            txt = _strip_matching_wrappers(txt)

        txt = txt.strip(" \t\r\n\"'`.,;:!?()[]{}<>")
        return txt

    def _clean_quote_text(s: Any) -> str:
        """
        Wrapper used when populating direct_quote_lookup; keeps it aligned
        with _clean_quote used for the PDF hits map.
        """
        return _clean_quote(s)

    def _build_meta_index_from_df(df_obj: Any) -> Dict[str, MetaIndexEntry]:
        out_index: Dict[str, MetaIndexEntry] = {}
        if not hasattr(df_obj, "columns"):
            return out_index
        cols = set(list(df_obj.columns))
        key_col = "item_key" if "item_key" in cols else ("key" if "key" in cols else None)
        if key_col is None:
            return out_index

        for _, row in df_obj.iterrows():
            k = _norm_str(row.get(key_col))
            if k is None:
                continue
            author_summary = _norm_str(row.get("author_summary")) or _norm_str(row.get("creator_summary"))
            first_author_last = _first_author_last_from(author_summary)
            year_val = _norm_str(row.get("year"))
            title_val = _norm_str(row.get("title"))
            source_val = _norm_str(row.get("source")) or _norm_str(row.get("publicationTitle"))
            url_val = _norm_str(row.get("url")) or _norm_str(row.get("landing_page")) or _norm_str(row.get("doi_url"))

            out_index[k] = MetaIndexEntry(
                item_key=k,
                author_summary=author_summary,
                first_author_last=first_author_last,
                year=year_val,
                title=title_val,
                source=source_val,
                url=url_val,
            )
        return out_index

    def _build_pdf_lookup_from_df(df_obj: Any) -> Dict[str, str]:
        out: Dict[str, str] = {}
        if not hasattr(df_obj, "columns"):
            return out
        cols = set(list(df_obj.columns))
        key_col = "item_key" if "item_key" in cols else ("key" if "key" in cols else None)
        pdf_cols = [c for c in ("pdf_path", "local_pdf", "cached_pdf", "path") if c in cols]
        if key_col is None or not pdf_cols:
            return out
        pref = pdf_cols[0]
        for _, row in df_obj.iterrows():
            k = _norm_str(row.get(key_col))
            p = _norm_str(row.get(pref))
            if k and p:
                out[k] = p
        return out

    # 1) Build indices
    meta_index: Dict[str, MetaIndexEntry] = _build_meta_index_from_df(df)
    pdf_lookup_map: Dict[str, str] = _build_pdf_lookup_from_df(df)

    # 2) Build quote-hit map once, using CLEANED quotes as keys
    #    Shape: { item_key: { cleaned_quote: {page, section_title, section_text} } }
    #    Shape: { item_key: { cleaned_quote: {page, section_title, section_text} } }
    import json, os, hashlib


    jobs_flat = [(job, prompt) for _, jl in planned_files for (job, prompt) in jl]

    safe_coll = str(zotero_collection).strip().lower().replace(" ", "_")
    cache_dir = MAIN_APP_CACHE_DIR / "sections" / safe_coll
    cache_dir.mkdir(parents=True, exist_ok=True)

    pdf_sig_rows: list[str] = []
    for item_key, pdf_path in sorted(pdf_lookup_map.items()):
        st = os.stat(pdf_path)
        pdf_sig_rows.append(item_key + "||" + pdf_path + "||" + str(st.st_mtime_ns) + "||" + str(st.st_size))
    pdf_sig = hashlib.md5("\n".join(pdf_sig_rows).encode("utf-8")).hexdigest()[:12]

    cache_path = cache_dir / ("quote_hits_map__" + pdf_sig + ".json")

    if round1_direct_quote_cache and cache_path.is_file():
        with open(str(cache_path), "r", encoding="utf-8") as f:
            hits_map = json.load(f)
    else:
        hits_map = build_quote_hits_from_jobs(
            jobs=jobs_flat,
            df=df,
            pdf_lookup=pdf_lookup_map,
            threads=32,
        )
        if round1_direct_quote_cache:
            tmp_path = cache_dir / ("quote_hits_map__" + pdf_sig + ".json.tmp")
            with open(str(tmp_path), "w", encoding="utf-8") as f:
                json.dump(hits_map, f, ensure_ascii=False, indent=2)
            os.replace(str(tmp_path), str(cache_path))

    # 3) Hydrate each job payload IN-MEMORY with metadata + hit info
    #    Also re-encode payload_json so downstream readers can rely on batches only.
    for _, joblist in planned_files:

        for job, _p in joblist:
            payloads = job.get("payloads") or []
            new_payloads: list[dict[str, Any]] = []
            for rec in payloads:
                if not isinstance(rec, dict):
                    continue
                item_key = _norm_str(rec.get("item_key")) or ""
                meta = meta_index.get(item_key)
                direct_quote_raw = _norm_str(rec.get("direct_quote"))
                direct_quote_clean = _clean_quote(direct_quote_raw or "")

                # metadata hydration (preserve payload values if present)
                author_summary = _norm_str(rec.get("author_summary")) or (meta.author_summary if meta else None)
                first_author_last = _norm_str(rec.get("first_author_last")) or (
                    meta.first_author_last if meta else None)
                year_val = _norm_str(rec.get("year")) or (meta.year if meta else None)
                title_val = _norm_str(rec.get("title")) or (meta.title if meta else None)
                source_val = _norm_str(rec.get("source")) or (meta.source if meta else None)
                url_val = _norm_str(rec.get("url")) or (meta.url if meta else None)

                # page/section hydration via hits map
                # page/section hydration via hits map
                raw_page_val = rec.get("page")
                if isinstance(raw_page_val, int) and raw_page_val > 0:
                    page_val = raw_page_val
                else:
                    page_val = None

                section_title_val = rec.get("section_title")
                section_text_val = rec.get("section_text")
                citations_val = rec.get("citations")
                references_val = rec.get("references")

                if item_key and direct_quote_clean and isinstance(hits_map, dict):
                    h_for_item = hits_map.get(item_key) or {}
                    h = h_for_item.get(direct_quote_clean)
                    if isinstance(h, dict):
                        hit_page = h.get("page")
                        if page_val is None and isinstance(hit_page, int) and hit_page > 0:
                            page_val = hit_page
                        if not section_title_val:
                            section_title_val = h.get("section_title")
                        if not section_text_val:
                            section_text_val = h.get("section_text")
                        if citations_val is None:
                            citations_val = h.get("citations")
                        if references_val is None:
                            references_val = h.get("references")

                if page_val is None:
                    page_val = 0

                theme_val = (
                        _norm_str(rec.get("theme"))
                        or _norm_str(rec.get("payload_theme"))
                        or _norm_str(rec.get("potential_theme"))
                        or "(unspecified)"
                )

                rec_h: dict[str, Any] = dict(rec)
                rec_h["author_summary"] = author_summary
                rec_h["first_author_last"] = first_author_last
                rec_h["year"] = year_val
                rec_h["title"] = title_val
                rec_h["source"] = source_val
                rec_h["url"] = url_val
                rec_h["page"] = page_val
                rec_h["section_title"] = section_title_val
                rec_h["section_text"] = section_text_val
                rec_h["citations"] = citations_val
                rec_h["references"] = references_val

                rec_h["theme"] = theme_val
                if direct_quote_raw is not None:
                    rec_h["direct_quote"] = direct_quote_raw

                pdf_path_for_pj = _norm_str(rec_h.get("pdf_path")) or _norm_str(
                    pdf_lookup_map.get(_norm_str(rec_h.get("item_key")) or ""))

                pj = {
                    "rq_question": rec_h.get("rq_question"),
                    "overarching_theme": rec_h.get("overarching_theme"),
                    "theme": rec_h.get("theme"),
                    "evidence_type": rec_h.get("evidence_type"),
                    "direct_quote_id": rec_h.get("direct_quote_id"),
                    "direct_quote": rec_h.get("direct_quote"),
                    "paraphrase": rec_h.get("paraphrase"),
                    "researcher_comment": rec_h.get("researcher_comment"),
                    "relevance_score": rec_h.get("relevance_score"),
                    "score_bucket": rec_h.get("score_bucket"),
                    "first_author_last": rec_h.get("first_author_last"),
                    "author_summary": rec_h.get("author_summary"),
                    "title": rec_h.get("title"),
                    "source": rec_h.get("source"),
                    "url": rec_h.get("url"),
                    "pdf_path": pdf_path_for_pj,
                    "page": rec_h.get("page"),
                    "section_title": rec_h.get("section_title"),
                    "section_text": rec_h.get("section_text"),
                    "citations": rec_h.get("citations"),
                    "references": rec_h.get("references"),
                    "year": rec_h.get("year"),
                    "route": rec_h.get("route"),
                    "item_key": rec_h.get("item_key"),
                    "potential_theme": rec_h.get("potential_theme"),
                }
                rec_h["payload_json"] = json.dumps(pj, ensure_ascii=False)

                new_payloads.append(rec_h)
            job["payloads"] = new_payloads

    # # 4) Persist a hydrated batches file so other components read it directly
    # hydrated_batches_path = inputs_dir / "AI_BATCHES_HYDRATED.json"
    # with open(hydrated_batches_path, "w", encoding="utf-8") as f:
    #     json.dump(
    #         {"batches": [{**job, "analysis_prompt": prompt} for _, jl in planned_files for (job, prompt) in jl]},
    #         f,
    #         ensure_ascii=False,
    #         indent=2,
    #     )

    # 5) Build or load direct_quote_lookup / quote_hits according to round1_direct_quote_cache

    def _page_int_from_value(v: Any) -> int:
        """
        ###1. convert mixed page representations to an int
        ###2. enforce non-negative, defaulting to 0 when missing/invalid
        """
        if isinstance(v, int):
            if v > 0:
                return v
            return 0
        if isinstance(v, str):
            s = v.strip()
            if not s:
                return 0
            if s.isdigit():
                n = int(s)
                if n > 0:
                    return n
            return 0
        return 0

    dql_path = os.path.join(out_dir, "direct_quote_lookup.json")
    qh_path = os.path.join(out_dir, "quote_hits.json")

    if round1_direct_quote_cache and os.path.isfile(dql_path) and os.path.isfile(qh_path):
        with open(dql_path, "r", encoding="utf-8") as f:
            direct_quote_lookup: Dict[str, Dict[str, Any]] = json.load(f)
        with open(qh_path, "r", encoding="utf-8") as f:
            quote_hits: Dict[str, int] = json.load(f)

        if isinstance(direct_quote_lookup, dict):
            for dqid, meta in direct_quote_lookup.items():
                if isinstance(meta, dict):
                    meta["page"] = _page_int_from_value(meta.get("page"))

    else:
        direct_quote_lookup: Dict[str, Dict[str, Any]] = {}
        from collections import defaultdict as _dd
        quote_hits: Dict[str, int] = _dd(int)

        for _, joblist in planned_files:
            for job, _p in joblist:
                for rec in (job.get("payloads") or []):
                    if not isinstance(rec, dict):
                        continue

                    dqid = _ensure_dqid(rec)
                    item_key_val = _norm_str(rec.get("item_key")) or ""
                    dq_text = _clean_quote_text(rec.get("direct_quote"))
                    paraphrase_text = _norm_str(rec.get("paraphrase"))
                    researcher_comment_text = _norm_str(rec.get("researcher_comment"))
                    page_val_for_dql = _page_int_from_value(rec.get("page"))

                    pdf_path_val = _norm_str(rec.get("pdf_path")) or _norm_str(pdf_lookup_map.get(item_key_val))

                    if dqid not in direct_quote_lookup:
                        direct_quote_lookup[dqid] = {
                            "item_key": item_key_val,
                            "pdf_path": pdf_path_val,
                            "url": _norm_str(rec.get("url")),
                            "author_summary": _norm_str(rec.get("author_summary")),
                            "first_author_last": _norm_str(rec.get("first_author_last")),
                            "year": _norm_str(rec.get("year")),
                            "title": _norm_str(rec.get("title")),
                            "source": _norm_str(rec.get("source")),
                            "page": page_val_for_dql,
                            "section_title": _norm_str(rec.get("section_title")),
                            "section_text": _norm_str(rec.get("section_text")),
                            "rq_question": _norm_str(rec.get("rq_question")) or _norm_str(rec.get("_rq_question")),
                            "overarching_theme": _norm_str(rec.get("overarching_theme")) or _norm_str(
                                rec.get("_overarching_theme")
                            ),
                            "gold_theme": _norm_str(rec.get("gold_theme")),
                            "route": _norm_str(rec.get("route")),
                            "theme": (
                                    _norm_str(rec.get("theme"))
                                    or _norm_str(rec.get("payload_theme"))
                                    or _norm_str(rec.get("potential_theme"))
                                    or "(unspecified)"
                            ),
                            "potential_theme": _norm_str(rec.get("potential_theme")),
                            "evidence_type": _norm_str(rec.get("evidence_type")),
                            "evidence_type_norm": _norm_str(rec.get("evidence_type_norm")),
                            "direct_quote": dq_text if dq_text else None,
                            "direct_quote_clean": dq_text,
                            "paraphrase": paraphrase_text,
                            "researcher_comment": researcher_comment_text,
                        }

                    if item_key_val:
                        quote_hits[item_key_val] += 1

        with open(dql_path, "w", encoding="utf-8") as f:
            json.dump(direct_quote_lookup, f, ensure_ascii=False, indent=2)

        with open(qh_path, "w", encoding="utf-8") as f:
            json.dump(quote_hits, f, ensure_ascii=False, indent=2)

        # optional sanity check: read back and compare to in-memory dict
        with open(dql_path, "r", encoding="utf-8") as f:
            dql_on_disk = json.load(f)

        if dql_on_disk == direct_quote_lookup:
            print("[CHECK] direct_quote_lookup JSON written correctly.")
        else:
            print("[CHECK] MISMATCH: in-memory direct_quote_lookup != JSON on disk.")

        # count how many entries have page > 1 (using the on-disk version)
        count_pages_gt1 = 0
        for meta in dql_on_disk.values():
            if isinstance(meta, dict):
                page_value = meta.get("page")
                if isinstance(page_value, int) and page_value > 1:
                    count_pages_gt1 = count_pages_gt1 + 1

        print("[CHECK] direct_quote_lookup entries with page > 1:", count_pages_gt1)

        input("stop")
    all_jobs_flat = [job for _, jl in planned_files for (job, _p) in jl]

    batch_ns = SimpleNamespace(
        planned_files=planned_files,
        direct_quote_lookup=direct_quote_lookup,
        quote_hits=quote_hits,
        out_dir=str(out_dir),
        all_jobs_flat=all_jobs_flat,
        manifest_path=None,
    )

    rr = running_rounds(
        collection_name=batch_label,
        # batch_size=batch_size,
        # batch_overlapping=batch_overlapping,
        df=df,
        batch=batch_ns,
        user_prompt=user_prompt_final,
        round2=round2_mode,
        framework_analysis=framework_effective,
        progress_cb=progress_cb,
        percent_cb=percent_cb,
        direct_quote_lookup=direct_quote_lookup,
        quote_hits=quote_hits,
    )

    return {
        "batch_label": batch_label,
        "zotero_collection": zotero_collection,
        "out_dir": str(out_dir),
        "num_batches": len(planned_files),
        "submitted": True,
        "read_ok": True,
        "outputs": rr.outputs_round1,
        "round1_sections": rr.round1_sections_merged,
        "num_batches_round2": rr.num_batches_round2,
        "custom_ids_round2": rr.custom_ids_round2,
        "outputs_round2": rr.outputs_round2,
        "export_paths": rr.export_paths,
        # this is what the mini Zotero right panel will consume
    }



def _parse_date_ranges(dates_str: str) -> List[Tuple[int, int]]:
    """
    Parse user-supplied year ranges into [(start, end), ...].

    Accepted input formats:
      - "2003-2006,2008-2015"
      - "2003-2006;2008-2015"
      - "2003-2006:2008-2015"
      - Mixed separators: "2003-2006; 2008-2015, 2020-2022:2024-2024"
      - Whitespace anywhere is fine.

    Rules:
      • Each range MUST look like "<year>-<year>" after trimming.
        (dash is mandatory inside each range)
      • Years must be parseable ints.
      • If start > end, we flip them.
      • Invalid chunks are silently skipped.

    Returns:
      list of (start_int, end_int), in the order we saw them (no merging).
    """
    ranges: List[Tuple[int, int]] = []
    if not dates_str:
        return ranges

    # 1. Split on , ; :  (any of them, any number of them)
    #    Example: "2003-2006;2008-2015:2020-2022"
    #    -> ["2003-2006", "2008-2015", "2020-2022"]
    chunks = re.split(r"[,:;]+", str(dates_str))

    for raw_chunk in chunks:
        chunk = raw_chunk.strip()
        if not chunk:
            continue

        # 2. We REQUIRE a dash between start and end.
        #    Allow sloppy spaces like "2003 - 2006"
        m = re.match(r"^\s*(\d{3,4})\s*-\s*(\d{3,4})\s*$", chunk)
        if not m:
            # doesn't match YEAR-YEAR → ignore
            continue

        y1_str, y2_str = m.groups()
        try:
            y1 = int(y1_str)
            y2 = int(y2_str)
        except Exception:
            continue

        # normalize ordering just in case
        start, end = (y1, y2) if y1 <= y2 else (y2, y1)

        ranges.append((start, end))

    return ranges



def _coerce_year(y_val: Any) -> Optional[int]:
    """
    Try to coerce whatever we got (string, int, etc.) into an int year.
    Return None if it can't be parsed.
    """
    if y_val is None:
        return None
    try:
        y_str = str(y_val).strip()
        if not y_str:
            return None
        return int(y_str)
    except Exception:
        return None


def _bucket_for_year_by_ranges(
    year_i: Optional[int],
    ranges_list: List[Tuple[int, int]]
) -> Optional[str]:
    """
    Given a concrete year like 2012, and a list of ranges like
    [(2003,2006),(2008,2015)], return the *range label* "2003-2006"
    or "2008-2015" if the year falls inside one of them.

    Return None if year_i is None OR doesn't fall in any provided range.
    """
    if year_i is None:
        return None
    for (start, end) in ranges_list:
        if start <= year_i <= end:
            return f"{start}-{end}"
    return None


def _push_leaf(tree: Dict[str, Any], trail: List[str], rec: Dict[str, Any]) -> None:
    """
    Walk/create nested dicts following all but last key in `trail`,
    then append `rec` into a list at the final key.

    trail example (mode="ranges"):
        ["2008-2015", "RQ text", "overarching theme", "some theme"]

    We produce:
        tree["2008-2015"]["RQ text"]["overarching theme"]["some theme"] = [ rec, ... ]
    """
    if not trail:
        return
    cur = tree
    *parents, last_key = trail
    for key in parents:
        nxt = cur.get(key)
        if not isinstance(nxt, dict):
            nxt = {}
            cur[key] = nxt
        cur = nxt
    leaf = cur.get(last_key)
    if not isinstance(leaf, list):
        leaf = []
        cur[last_key] = leaf
    leaf.append(rec)


def _collapse_placeholder_gold(
    groups: Dict[str, Any],
    mode: str,
    placeholder: str = GOLD_PLACEHOLDER,
) -> Dict[str, Any]:
    """
    Post-process the nested dict we built so that if the ONLY overarching_theme
    in a branch is "NA", we drop that useless layer.

    Concretely:
    - year / ranges / etype modes:
        groups[top][rq][gold][theme] -> list
        If for a given (top, rq) the only `gold` key is placeholder,
        collapse to:
            groups[top][rq] = { theme: [list...] }

    - rq mode:
        groups[rq][gold][theme] -> list
        If the only gold key under that rq is placeholder:
            groups[rq] = { theme: [list...] }

    - author mode:
        groups[gold][rq][theme] -> list
        If the ONLY top-level gold key in the entire groups dict is placeholder:
            collapse top level entirely:
                groups = groups[placeholder]    # rq -> {theme: [list...]}

    - theme mode:
        groups[theme][gold][rq] -> list
        For each theme bucket, if the only gold key is placeholder:
            groups[theme] = { rq: [list...] }

    NOTE: we mutate in place where practical, and sometimes return a new dict
    for the author/global collapse case.
    """

    # modes where hierarchy was [top][rq][gold][theme]
    if mode in ("year", "ranges", "etype"):
        for top_key, rq_map in list(groups.items()):
            if not isinstance(rq_map, dict):
                continue
            for rq_key, gold_map in list(rq_map.items()):
                if not isinstance(gold_map, dict):
                    continue
                gold_keys = list(gold_map.keys())
                if len(gold_keys) == 1 and gold_keys[0] == placeholder:
                    # replace groups[top][rq] with the inner theme dict
                    groups[top_key][rq_key] = gold_map[placeholder]

        return groups

    # mode rq:
    # groups[rq_key][gold][theme] -> list
    if mode == "rq":
        for rq_key, gold_map in list(groups.items()):
            if not isinstance(gold_map, dict):
                continue
            gold_keys = list(gold_map.keys())
            if len(gold_keys) == 1 and gold_keys[0] == placeholder:
                groups[rq_key] = gold_map[placeholder]
        return groups

    # mode author:
    # groups[gold][rq][theme] -> list
    # If *only* top-level key is placeholder, drop that layer.
    if mode == "author":
        gold_keys = list(groups.keys())
        if len(gold_keys) == 1 and gold_keys[0] == placeholder:
            only_map = groups[placeholder]
            if isinstance(only_map, dict):
                # collapse to rq->theme->list
                return only_map
        return groups

    # mode theme:
    # groups[theme_key][gold][rq] -> list
    # Collapse per-theme if only placeholder.
    if mode == "theme":
        for theme_key, gold_map in list(groups.items()):
            if not isinstance(gold_map, dict):
                continue
            gold_keys = list(gold_map.keys())
            if len(gold_keys) == 1 and gold_keys[0] == placeholder:
                groups[theme_key] = gold_map[placeholder]
        return groups

    # fallback: nothing
    return groups
def grouping_widget_data(
    *,
    cards: List[Dict[str, Any]],   # AI_MODAL_RESULT["payloads"]
    filters: Dict[str, Any],
    dates: str,
    batch_size: int,
    extra_prompt: str,
    **kwargs: Any,
) -> Dict[str, Any]:
    """
    Build nested groups from the modal slice for downstream batching.

    Priority for first-layer mode:
      1. explicit year filters  -> mode="year"
      2. explicit date ranges   -> mode="ranges"
      3. evidence type filter   -> mode="etype"
      4. author filter          -> mode="author"
      5. theme filter           -> mode="theme"
      6. default                -> mode="rq"

    After we build, we collapse the "NA"
    layer if it's the only overarching layer in that branch.
    """

    def _has_any(val: Any) -> bool:
        if val is None:
            return False
        if isinstance(val, str):
            return bool(val.strip())
        if isinstance(val, (list, tuple, set)):
            return len(val) > 0
        return bool(val)

    # --- normalize filters ---
    rq_selected        = set(filters.get("rq")            or [])
    theme_selected     = set(filters.get("theme")         or [])
    authors_selected   = set(filters.get("authors")       or [])
    years_selected_raw = set(filters.get("years")         or [])
    evtype_selected    = set(filters.get("evidence_type") or filters.get("evidence") or [])

    # coerce years filter -> ints
    years_selected: set[int] = set()
    for y in years_selected_raw:
        try:
            years_selected.add(int(str(y).strip()))
        except Exception:
            pass

    # parse the date-range string (robust parser from thematic_functions.py)
    ranges_list = _parse_date_ranges(dates)

    # decide mode by priority
    if years_selected:
        mode = "year"
    elif ranges_list:
        mode = "ranges"
    elif evtype_selected:
        mode = "etype"
    elif authors_selected:
        mode = "author"
    elif theme_selected:
        mode = "theme"
    else:
        mode = "rq"

    groups: Dict[str, Any] = {}
    routes_seen: set[str] = set()

    for card in cards or []:
        payload = card.get("payload", {}) or {}
        meta    = card.get("metadata", {}) or {}

        # >>> pull RQ with all known fallbacks
        rq_text = (
            payload.get("rq_question")
            or payload.get("_rq_question")
            or payload.get("rq")
            or meta.get("rq_question")
            or ""
        )
        rq_text = str(rq_text).strip() or "(no RQ)"

        # >>> pull overarching/gold theme with all fallbacks
        gold = (
            payload.get("overarching_theme")
            or payload.get("gold_theme")
            or payload.get("_overarching_theme")
            or meta.get("gold_theme")
            or meta.get("overarching_theme")
            or ""
        )
        gold = str(gold).strip() or GOLD_PLACEHOLDER

        theme_val = (payload.get("theme") or "").strip() or "(unspecified)"
        etype = (payload.get("evidence_type") or "").strip().lower() or "mixed"

        route = (meta.get("route") or payload.get("route") or "").strip()
        if route:
            routes_seen.add(route)

        year_i = _coerce_year(payload.get("year", None) or meta.get("year", None))

        rec = {
            "rq_question": rq_text,
            "overarching_theme": gold,
            "theme": theme_val,
            "evidence_type": (
                (payload.get("evidence_type") or payload.get("evidence_type_norm") or meta.get(
                    "evidence_type") or etype)
            ).strip().lower() if isinstance(
                (payload.get("evidence_type") or payload.get("evidence_type_norm") or meta.get(
                    "evidence_type") or etype), str
            ) else etype,
            "direct_quote_id": payload.get("direct_quote_id"),
            "direct_quote": payload.get("direct_quote"),
            "paraphrase": payload.get("paraphrase"),
            "researcher_comment": payload.get("researcher_comment"),
            "relevance_score": payload.get("relevance_score"),
            "score_bucket": payload.get("score_bucket") if payload.get("score_bucket") is not None else meta.get(
                "score_bucket"),
            "first_author_last": (
                    payload.get("first_author_last")
                    or meta.get("first_author_last")
                    or payload.get("author_summary")
                    or meta.get("author_summary")
            ),
            "author_summary": payload.get("author_summary") or meta.get("author_summary"),
            "author": payload.get("author") or meta.get("author"),
            "title": payload.get("title") or meta.get("title"),
            "source": payload.get("source") or meta.get("source"),
            "url": payload.get("url") or meta.get("url"),
            "page": payload.get("page") if payload.get("page") not in (None, "") else meta.get("page"),
            "section_title": payload.get("section_title") or meta.get("section_title"),
            "section_text": payload.get("section_text") or meta.get("section_text"),
            "year": _coerce_year(payload.get("year", None) or meta.get("year", None) or year_i),
            "route": route,
            "item_key": payload.get("item_key") or meta.get("item_key"),
            "potential_theme": payload.get("potential_theme") or meta.get("potential_theme"),
            "all_potential_themes": payload.get("all_potential_themes") or meta.get("all_potential_themes") or [],
            "payload_json": payload.get("payload_json") or "",
        }

        # Decide nesting keys ("trail") based on mode (unchanged logic below)
        if mode == "year":
            top_key = str(year_i) if year_i is not None else "(no year)"
            trail = [top_key, rq_text, gold, theme_val]

        elif mode == "ranges":
            bucket_label = _bucket_for_year_by_ranges(year_i, ranges_list)
            if bucket_label is None:
                continue
            trail = [bucket_label, rq_text, gold, theme_val]

        elif mode == "etype":
            trail = [etype, rq_text, gold, theme_val]

        elif mode == "author":
            trail = [gold, rq_text, theme_val]

        elif mode == "theme":
            trail = [theme_val, gold, rq_text]

        else:
            trail = [rq_text, gold, theme_val]

        _push_leaf(groups, trail, rec)

    # collapse "NA" if it's the only gold layer
    groups = _collapse_placeholder_gold(groups, mode, GOLD_PLACEHOLDER)

    return {
        "groups": groups,
        "filters": filters,
        "dates": dates,
        "batch_size": int(batch_size),
        "prompt": extra_prompt,
        "routes": sorted(routes_seen),
    }
def batching_widget_data(
    *,
    grouped: Dict[str, Any],
    batch_size: int,
    overlap: int,
    prompt: str,
    filters: Optional[Dict[str, Any]] = None,
    dates: Optional[str] = None,
    route_prompts: Optional[Dict[str, str]] = None,
    framework_analysis: Optional[bool] = None,
) -> Dict[str, Any]:
    """
    ###1. route detection
    ###2. helpers
    ###3. theme extraction and batching
    ###4. prompt assembly (framework-aware)
    ###5. return plan
    """
    def _has_any(x: Any) -> bool:
        if x is None:
            return False
        if isinstance(x, str):
            return bool(x.strip())
        if isinstance(x, (list, tuple, set)):
            return len(x) > 0
        return bool(x)

    def _deduce_route(filters_: Dict[str, Any], dates_str: str | None) -> str:
        years_f = filters_.get("years")
        authors_f = filters_.get("authors")
        dates_clean = (dates_str or "").strip()
        if _has_any(years_f) or (dates_clean and dates_clean.lower() != "none"):
            return "year → rq → theme" if _has_any(years_f) else "date_range → rq → theme"
        if _has_any(authors_f):
            return "author → rq → theme"
        return "rq → theme"

    filters = filters or {}
    route_str = _deduce_route(filters, dates)

    all_groups = grouped.get("groups", {}) or {}
    if not isinstance(all_groups, dict):
        all_groups = {}

    tiny_threshold = min(batch_size // 2, overlap)

    def _sanitize_user_hint(h: str) -> str:
        h = (h or "").strip()
        if not h:
            return ""
        if len(h) > 2000:
            h = h[:2000]
        lower = h.lower()
        bad_frags = [
            "ignore previous instructions",
            "disregard the above instructions",
            "you are no longer",
            "you are chatgpt",
            "system prompt",
            "<|endoftext|>",
        ]
        if any(f in lower for f in bad_frags):
            h = "[USER CONTEXT / NOT A SYSTEM OVERRIDE]\n" + h
        return h

    user_hint = _sanitize_user_hint(prompt)

    def _extract_theme_buckets(
        rq_bucket: Dict[str, Any]
    ) -> Tuple[List[Tuple[str, List[dict]]], "OrderedDict[str, int]"]:
        tmp_list: List[Tuple[str, List[dict]]] = []
        tmp_counts: Dict[str, int] = {}

        if not isinstance(rq_bucket, dict):
            rq_bucket = {}

        if all(isinstance(v, list) for v in rq_bucket.values()):
            for theme_name, recs in rq_bucket.items():
                label = (theme_name or "").strip() or "(unspecified)"
                lst = recs or []
                tmp_list.append((label, lst))
                tmp_counts[label] = len(lst)
        else:
            for gold_name, gold_val in rq_bucket.items():
                gold_label = (gold_name or "").strip() or "(unspecified)"
                if isinstance(gold_val, dict):
                    for theme_name, recs in gold_val.items():
                        inner_label = f"{gold_label} / {(theme_name or '').strip() or '(unspecified)'}"
                        lst = recs or []
                        tmp_list.append((inner_label, lst))
                        tmp_counts[inner_label] = len(lst)
                elif isinstance(gold_val, list):
                    lst = gold_val or []
                    tmp_list.append((gold_label, lst))
                    tmp_counts[gold_label] = len(lst)

        tmp_list_sorted = sorted(tmp_list, key=lambda p: p[0].lower())
        ordered_counts = OrderedDict(sorted(tmp_counts.items(), key=lambda kv: kv[0].lower()))
        return tmp_list_sorted, ordered_counts

    def _balanced_sizes(total: int, k: int) -> List[int]:
        sizes: List[int] = []
        remaining = total
        buckets_left = k
        while buckets_left > 0:
            sz = (remaining + buckets_left - 1) // buckets_left
            sizes.append(sz)
            remaining -= sz
            buckets_left -= 1
        return sizes

    def _plan_theme_chunks(
        recs: List[dict],
        batch_size_local: int,
        overlap_local: int,
        tiny_thr_local: int,
    ) -> Tuple[List[List[dict]], bool]:
        n = len(recs)
        if n <= 0:
            return ([], True)

        limit_single = batch_size_local + overlap_local
        double_limit = batch_size_local * 2

        if n < tiny_thr_local:
            return ([], True)

        if n <= limit_single:
            return ([recs], False)

        if n < double_limit:
            mid = (n + 1) // 2
            return ([recs[:mid], recs[mid:]], False)

        base_batches = max(1, n // batch_size_local)
        if base_batches < 2:
            base_batches = 2

        sizes = _balanced_sizes(n, base_batches)
        out_chunks: List[List[dict]] = []
        idx = 0
        for sz in sizes:
            out_chunks.append(recs[idx: idx + sz])
            idx += sz
        return (out_chunks, False)

    def _merge_tiny_themes(
        tiny_theme_list: List[Tuple[str, List[dict]]],
        batch_size_local: int,
    ) -> List[Tuple[List[dict], OrderedDict]]:
        merged_batches: List[Tuple[List[dict], OrderedDict]] = []
        cur_payload: List[dict] = []
        cur_breakdown: OrderedDict[str, int] = OrderedDict()
        for (tlabel, trecs) in tiny_theme_list:
            if cur_payload and (len(cur_payload) + len(trecs) > batch_size_local):
                merged_batches.append((cur_payload, cur_breakdown))
                cur_payload = []
                cur_breakdown = OrderedDict()
            cur_payload.extend(trecs)
            cur_breakdown[tlabel] = cur_breakdown.get(tlabel, 0) + len(trecs)
        if cur_payload:
            merged_batches.append((cur_payload, cur_breakdown))
        return merged_batches

    def _majority_evidence_type(records: List[dict]) -> str:
        counts: Dict[str, int] = {}
        for r in records or []:
            raw = r.get("evidence_type")
            et = raw.strip().lower() if isinstance(raw, str) else "mixed"
            if not et:
                et = "mixed"
            counts[et] = counts.get(et, 0) + 1
        if not counts:
            return "mixed"
        return max(counts.items(), key=lambda kv: kv[1])[0]

    final_batches: List[Dict[str, Any]] = []
    layer1_overview: List[Dict[str, Any]] = []

    for layer1_key, rq_map in all_groups.items():
        if not isinstance(rq_map, dict):
            rq_map = {}

        rq_overview_list: List[Dict[str, Any]] = []

        for rq_key, rq_bucket in rq_map.items():
            theme_list_sorted, theme_counts_ordered = _extract_theme_buckets(
                rq_bucket if isinstance(rq_bucket, dict) else {}
            )
            rq_overview_list.append({"rq_key": rq_key, "themes": theme_counts_ordered})

            planned_per_theme: List[Tuple[str, List[List[dict]], bool, int]] = []
            tiny_themes: List[Tuple[str, List[dict]]] = []

            for (theme_label, recs_for_theme) in theme_list_sorted:
                chunks, is_tiny_flag = _plan_theme_chunks(
                    recs_for_theme, batch_size, overlap, tiny_threshold
                )
                total_items = len(recs_for_theme)
                if is_tiny_flag:
                    tiny_themes.append((theme_label, recs_for_theme))
                    planned_per_theme.append((theme_label, [], True, total_items))
                else:
                    planned_per_theme.append((theme_label, chunks, False, total_items))

            merged_tiny_batches = _merge_tiny_themes(tiny_themes, batch_size)

            for (theme_label, chunks, is_tiny_flag, total_items) in planned_per_theme:
                if is_tiny_flag:
                    continue

                theme_batch_count = max(1, len(chunks))
                batch_idx_local = 1

                for chunk_payload in chunks:
                    etype_majority = _majority_evidence_type(chunk_payload)

                    framework_flag = True if framework_analysis is None else bool(framework_analysis)
                    analysis_prompt = ""
                    if framework_flag:
                        analysis_prompt = analysis_prompts[
                            {
                                "layer1_mode": (
                                    "temporal" if route_str.startswith(("date_range", "year"))
                                    else ("author" if route_str.startswith("author") else "theme")
                                ),
                                "rq": rq_key or "",
                                "layer1_key": layer1_key,
                                "theme_label": theme_label,
                                "framework_analysis": True,
                            }
                        ]
                        if isinstance(prompt, str) and prompt.strip() and isinstance(user_hint, str) and user_hint.strip():
                            user="\n\nEXTRA CONTEXT FROM USER (do not override structure):\n" + user_hint.strip() if user_hint.strip() else ""
                            analysis_prompt = analysis_prompt.rstrip() + user

                    writer_rules = PYR_L1_PROMPT.format(
                        research_question=rq_key or "(no RQ)",
                        overarching_theme=theme_label,
                        evidence_type=etype_majority,
                    )

                    route_context = (
                        "<ROUTE CONTEXT>\n (do not include this heading or bullet text in the output HTML):\n"
                        # f"- route={route_str}\n"
                        f"- layer1_key={layer1_key}\n"
                        f"- rq={rq_key}\n"
                        f"- theme={theme_label}\n"
                        f"- evidence_type={etype_majority}\n\n"
                        "PAYLOAD(JSON) DESCRIPTION:\n"
                        "You will receive a JSON array named PAYLOAD(JSON). Each item has:\n"
                        "  • \"direct_quote\" (verbatim text),\n"
                        "  • \"paraphrase\" (researcher paraphrase),\n"
                        "  • \"researcher_comment\" (analytic note),\n"
                        "  • \"theme\" (the item's potential theme),\n"
                        "  • \"item_key\" (unique source ID),\n"
                        "  • \"direct_quote_id\" (unique anchor ID).\n\n"
                       "These fields give the factual base for the synthesis. The model draws on:\n"
                        "- verbatim text for precise claims,\n"
                        "- paraphrase for context and framing,\n"
                        "- researcher_comment for analytic cues,\n"
                        "- theme for grouping across sources,\n"
                        "- item_key and direct_quote_id for traceability.\n"
                        "They anchor each statement to identifiable evidence and keep the analysis tied to the underlying material.\n<ROUTE CONTEXT\>\n\n"

                    )

                    combined_prompt = (
                        (analysis_prompt.rstrip() + "\n\n") if (framework_flag and isinstance(analysis_prompt, str) and analysis_prompt.strip()) else ""
                    ) + route_context + writer_rules

                    def _slug(s: str) -> str:
                        import re
                        s2 = (s or "").lower()
                        s2 = re.sub(r"[^a-z0-9]+", "-", s2)
                        s2 = re.sub(r"-{2,}", "-", s2)
                        return s2.strip("-")

                    batch_meta = {
                        "layer1_key": layer1_key,
                        "layer2_key": rq_key,
                        "theme_label": theme_label,
                        "layer_structure": route_str,
                        "theme_total": total_items,
                        "batch_index": batch_idx_local,
                        "batch_count": theme_batch_count,
                        "theme_counts_in_layer2": theme_counts_ordered,
                        "batch_size_limit": batch_size,
                        "overlap_slack": overlap,
                        "merged_theme_breakdown": None,
                        "collection_suffix": f"{_slug(layer1_key)}__{_slug(route_str)}__b{batch_idx_local:02d}",
                        "collection_route_index": f"{_slug(route_str)}__b{batch_idx_local:02d}",
                    }

                    chunk_payload_norm = [
                        {
                            **(r or {}),
                            "direct_quote": (r.get("direct_quote") or ""),
                            "paraphrase": (r.get("paraphrase") or ""),
                            "researcher_comment": (r.get("researcher_comment") or ""),
                            "theme": (r.get("theme") or r.get("payload_theme") or r.get("potential_theme") or "(unspecified)"),
                            "potential_theme": (r.get("potential_theme") or ""),
                            "item_key": (r.get("item_key") or ""),
                            "direct_quote_id": (r.get("direct_quote_id") or ""),
                            "author_summary": (r.get("author_summary") or ""),
                            "first_author_last": (r.get("first_author_last") or ""),
                            "year": (r.get("year") or ""),
                            "title": (r.get("title") or ""),
                            "source": (r.get("source") or r.get("publicationTitle") or ""),
                            "url": (r.get("url") or ""),
                            "page": (r.get("page") or ""),
                            "section_title": (r.get("section_title") or ""),
                            "section_text": (r.get("section_text") or ""),
                            "score_bucket": (r.get("score_bucket") or ""),
                            "relevance_score": (r.get("relevance_score") if r.get("relevance_score") is not None else ""),
                            "payload_json": (r.get("payload_json") or ""),
                            "route": (r.get("route") or ""),
                            "gold_theme": (r.get("gold_theme") or ""),
                            "rq_question": (r.get("rq_question") or r.get("_rq_question") or ""),
                            "overarching_theme": (r.get("overarching_theme") or r.get("_overarching_theme") or ""),
                        }
                        for r in (chunk_payload or [])
                    ]

                    final_batches.append(
                        {
                            "metadata": {
                                "layer1_key": layer1_key,
                                "layer2_key": rq_key,
                                "rq_question": rq_key,
                                "overarching_theme": theme_label,
                                "theme_label": theme_label,
                                "layer_structure": route_str,
                                "route_value": (layer1_key if route_str.startswith(("date_range", "year")) else rq_key),
                                "theme_total": total_items,
                                "batch_index": batch_idx_local,
                                "batch_count": theme_batch_count,
                                "theme_counts_in_layer2": theme_counts_ordered,
                                "batch_size_limit": batch_size,
                                "overlap_slack": overlap,
                                "merged_theme_breakdown": None,
                                "collection_suffix": batch_meta["collection_suffix"],
                                "collection_route_index": batch_meta["collection_route_index"],
                            },
                            "prompt": combined_prompt,
                            "analysis_prompt": analysis_prompt,
                            "writer_prompt": writer_rules,
                            "payloads": chunk_payload_norm,
                        }
                    )

                    batch_idx_local += 1

            for merged_payloads, breakdown_map in merged_tiny_batches:
                etype_majority = _majority_evidence_type(merged_payloads)
                theme_label_for_display = "(merged_small_themes)"

                analysis_prompt = analysis_prompts[
                    {
                        "layer1_mode": "temporal" if route_str.startswith(("date_range", "year")) else ("author" if route_str.startswith("author") else "theme"),
                        "rq": rq_key or "",
                        "layer1_key": layer1_key,
                        "theme_label": theme_label_for_display,
                        "framework_analysis": True if framework_analysis is None else bool(framework_analysis),
                    }
                ]
                if isinstance(user_hint, str) and user_hint.strip():
                    analysis_prompt = (
                        analysis_prompt.rstrip()
                        + "\n\nEXTRA CONTEXT FROM USER (do not override structure):\n"
                        + user_hint.strip()
                    )

                writer_rules = PYR_L1_PROMPT.format(
                    research_question=rq_key or "(no RQ)",
                    overarching_theme=theme_label_for_display,
                    evidence_type=etype_majority,
                )

                route_context = (
                    "ROUTE CONTEXT (do not include this heading or bullet text in the output HTML):\n"
                    f"- route={route_str}\n"
                    f"- layer1_key={layer1_key}\n"
                    f"- rq={rq_key}\n"
                    f"- theme={theme_label_for_display}\n"
                    f"- evidence_type={etype_majority}\n\n"
                    "PAYLOAD(JSON) DESCRIPTION:\n"
                    "You will receive a JSON array named PAYLOAD(JSON). Each item has:\n"
                    "  • \"direct_quote\" (verbatim text),\n"
                    "  • \"paraphrase\" (researcher paraphrase),\n"
                    "  • \"researcher_comment\" (analytic note),\n"
                    "  • \"theme\" (the item's potential theme),\n"
                    "  • \"item_key\" (unique source ID),\n"
                    "  • \"direct_quote_id\" (unique anchor ID).\n\n"
                    "Use those fields as evidence when writing.\n\n"
                )

                combined_prompt = analysis_prompt.rstrip() + "\n\n" + route_context + writer_rules

                def _slug(s: str) -> str:
                    import re
                    s2 = (s or "").lower()
                    s2 = re.sub(r"[^a-z0-9]+", "-", s2)
                    s2 = re.sub(r"-{2,}", "-", s2)
                    return s2.strip("-")

                batch_meta = {
                    "layer1_key": layer1_key,
                    "layer2_key": rq_key,
                    "theme_label": theme_label_for_display,
                    "layer_structure": route_str,
                    "theme_total": sum(breakdown_map.values()),
                    "batch_index": None,
                    "batch_count": None,
                    "theme_counts_in_layer2": theme_counts_ordered,
                    "batch_size_limit": batch_size,
                    "overlap_slack": overlap,
                    "merged_theme_breakdown": breakdown_map,
                    "collection_suffix": f"{_slug(layer1_key)}__{_slug(route_str)}__merged",
                    "collection_route_index": f"{_slug(route_str)}__merged",
                }

                merged_payloads_norm = [
                    {
                        **(r or {}),
                        "direct_quote": (r.get("direct_quote") or ""),
                        "paraphrase": (r.get("paraphrase") or ""),
                        "researcher_comment": (r.get("researcher_comment") or ""),
                        "theme": (r.get("theme") or r.get("payload_theme") or r.get("potential_theme") or "(unspecified)"),
                        "potential_theme": (r.get("potential_theme") or ""),
                        "item_key": (r.get("item_key") or ""),
                        "direct_quote_id": (r.get("direct_quote_id") or ""),
                        "author_summary": (r.get("author_summary") or ""),
                        "first_author_last": (r.get("first_author_last") or ""),
                        "year": (r.get("year") or ""),
                        "title": (r.get("title") or ""),
                        "source": (r.get("source") or r.get("publicationTitle") or ""),
                        "url": (r.get("url") or ""),
                        "page": (r.get("page") or ""),
                        "section_title": (r.get("section_title") or ""),
                        "section_text": (r.get("section_text") or ""),
                        "score_bucket": (r.get("score_bucket") or ""),
                        "relevance_score": (r.get("relevance_score") if r.get("relevance_score") is not None else ""),
                        "payload_json": (r.get("payload_json") or ""),
                        "route": (r.get("route") or ""),
                        "gold_theme": (r.get("gold_theme") or ""),
                        "rq_question": (r.get("rq_question") or r.get("_rq_question") or ""),
                        "overarching_theme": (r.get("overarching_theme") or r.get("_overarching_theme") or ""),
                    }
                    for r in (merged_payloads or [])
                ]

                final_batches.append(
                    {
                        "batch_kind": "merged_tiny",
                        "metadata": batch_meta,
                        "prompt": combined_prompt,
                        "analysis_prompt": analysis_prompt,
                        "writer_prompt": writer_rules,
                        "payloads": merged_payloads_norm,
                    }
                )

        layer1_overview.append({"layer1_key": layer1_key, "rqs": rq_overview_list})

    return {
        "route": route_str,
        "batch_size": batch_size,
        "overlap": overlap,
        "total_batches": len(final_batches),
        "layer1_overview": layer1_overview,
        "batches": final_batches,
    }


# def batching_widget_data(
#     *,
#     grouped: Dict[str, Any],
#     batch_size: int,
#     overlap: int,
#     prompt: str,
#     filters: Optional[Dict[str, Any]] = None,
#     dates: Optional[str] = None,
#     route_prompts: Optional[Dict[str, str]] = None,
#     framework_analysis: Optional[bool] = None,
# ) -> Dict[str, Any]:
#     """
#     ###1. route detection
#     ###2. helpers
#     ###3. theme extraction and batching
#     ###4. prompt assembly (framework-aware)
#     ###5. return plan
#     """
#
#     def _has_any(x: Any) -> bool:
#         if x is None:
#             return False
#         if isinstance(x, str):
#             return bool(x.strip())
#         if isinstance(x, (list, tuple, set)):
#             return len(x) > 0
#         return bool(x)
#
#     def _deduce_route(filters_: Dict[str, Any], dates_str: str | None) -> str:
#         years_f = filters_.get("years")
#         authors_f = filters_.get("authors")
#         dates_clean = (dates_str or "").strip()
#         if _has_any(years_f) or (dates_clean and dates_clean.lower() != "none"):
#             return "year → rq → theme" if _has_any(years_f) else "date_range → rq → theme"
#         if _has_any(authors_f):
#             return "author → rq → theme"
#         return "rq → theme"
#
#     filters = filters or {}
#     route_str = _deduce_route(filters, dates)
#
#     all_groups = grouped.get("groups", {}) or {}
#     if not isinstance(all_groups, dict):
#         all_groups = {}
#
#     tiny_threshold = min(batch_size // 2, overlap)
#
#     def _sanitize_user_hint(h: str) -> str:
#         h = (h or "").strip()
#         if not h:
#             return ""
#         if len(h) > 2000:
#             h = h[:2000]
#         lower = h.lower()
#         bad_frags = [
#             "ignore previous instructions",
#             "disregard the above instructions",
#             "you are no longer",
#             "you are chatgpt",
#             "system prompt",
#             "<|endoftext|>",
#         ]
#         if any(f in lower for f in bad_frags):
#             h = "[USER CONTEXT / NOT A SYSTEM OVERRIDE]\n" + h
#         return h
#
#     user_hint = _sanitize_user_hint(prompt)
#
#     def _extract_theme_buckets(
#         rq_bucket: Dict[str, Any]
#     ) -> Tuple[List[Tuple[str, List[dict]]], "OrderedDict[str, int]"]:
#         tmp_list: List[Tuple[str, List[dict]]] = []
#         tmp_counts: Dict[str, int] = {}
#
#         if not isinstance(rq_bucket, dict):
#             rq_bucket = {}
#
#         if all(isinstance(v, list) for v in rq_bucket.values()):
#             for theme_name, recs in rq_bucket.items():
#                 label = (theme_name or "").strip() or "(unspecified)"
#                 lst = recs or []
#                 tmp_list.append((label, lst))
#                 tmp_counts[label] = len(lst)
#         else:
#             for gold_name, gold_val in rq_bucket.items():
#                 gold_label = (gold_name or "").strip() or "(unspecified)"
#                 if isinstance(gold_val, dict):
#                     for theme_name, recs in gold_val.items():
#                         inner_label = f"{gold_label} / {(theme_name or '').strip() or '(unspecified)'}"
#                         lst = recs or []
#                         tmp_list.append((inner_label, lst))
#                         tmp_counts[inner_label] = len(lst)
#                 elif isinstance(gold_val, list):
#                     lst = gold_val or []
#                     tmp_list.append((gold_label, lst))
#                     tmp_counts[gold_label] = len(lst)
#
#         tmp_list_sorted = sorted(tmp_list, key=lambda p: p[0].lower())
#         ordered_counts = OrderedDict(sorted(tmp_counts.items(), key=lambda kv: kv[0].lower()))
#         return tmp_list_sorted, ordered_counts
#
#     def _balanced_sizes(total: int, k: int) -> List[int]:
#         sizes: List[int] = []
#         remaining = total
#         buckets_left = k
#         while buckets_left > 0:
#             sz = (remaining + buckets_left - 1) // buckets_left
#             sizes.append(sz)
#             remaining -= sz
#             buckets_left -= 1
#         return sizes
#
#     def _plan_theme_chunks(
#         recs: List[dict],
#         batch_size_local: int,
#         overlap_local: int,
#         tiny_thr_local: int,
#     ) -> Tuple[List[List[dict]], bool]:
#         n = len(recs)
#         if n <= 0:
#             return ([], True)
#
#         limit_single = batch_size_local + overlap_local
#         double_limit = batch_size_local * 2
#
#         if n < tiny_thr_local:
#             return ([], True)
#
#         if n <= limit_single:
#             return ([recs], False)
#
#         if n < double_limit:
#             mid = (n + 1) // 2
#             return ([recs[:mid], recs[mid:]], False)
#
#         base_batches = max(1, n // batch_size_local)
#         if base_batches < 2:
#             base_batches = 2
#
#         sizes = _balanced_sizes(n, base_batches)
#         out_chunks: List[List[dict]] = []
#         idx = 0
#         for sz in sizes:
#             out_chunks.append(recs[idx: idx + sz])
#             idx += sz
#         return (out_chunks, False)
#
#     def _merge_tiny_themes(
#         tiny_theme_list: List[Tuple[str, List[dict]]],
#         batch_size_local: int,
#     ) -> List[Tuple[List[dict], OrderedDict]]:
#         merged_batches: List[Tuple[List[dict], OrderedDict]] = []
#         cur_payload: List[dict] = []
#         cur_breakdown: OrderedDict[str, int] = OrderedDict()
#         for (tlabel, trecs) in tiny_theme_list:
#             if cur_payload and (len(cur_payload) + len(trecs) > batch_size_local):
#                 merged_batches.append((cur_payload, cur_breakdown))
#                 cur_payload = []
#                 cur_breakdown = OrderedDict()
#             cur_payload.extend(trecs)
#             cur_breakdown[tlabel] = cur_breakdown.get(tlabel, 0) + len(trecs)
#         if cur_payload:
#             merged_batches.append((cur_payload, cur_breakdown))
#         return merged_batches
#
#     def _majority_evidence_type(records: List[dict]) -> str:
#         counts: Dict[str, int] = {}
#         for r in records or []:
#             raw = r.get("evidence_type")
#             et = raw.strip().lower() if isinstance(raw, str) else "mixed"
#             if not et:
#                 et = "mixed"
#             counts[et] = counts.get(et, 0) + 1
#         if not counts:
#             return "mixed"
#         return max(counts.items(), key=lambda kv: kv[1])[0]
#
#     final_batches: List[Dict[str, Any]] = []
#     layer1_overview: List[Dict[str, Any]] = []
#
#     for layer1_key, rq_map in all_groups.items():
#         if not isinstance(rq_map, dict):
#             rq_map = {}
#
#         rq_overview_list: List[Dict[str, Any]] = []
#
#         for rq_key, rq_bucket in rq_map.items():
#             theme_list_sorted, theme_counts_ordered = _extract_theme_buckets(
#                 rq_bucket if isinstance(rq_bucket, dict) else {}
#             )
#
#             rq_overview_list.append({"rq_key": rq_key, "themes": theme_counts_ordered})
#
#             planned_per_theme: List[Tuple[str, List[List[dict]], bool, int]] = []
#             tiny_themes: List[Tuple[str, List[dict]]] = []
#
#             for (theme_label, recs_for_theme) in theme_list_sorted:
#                 chunks, is_tiny_flag = _plan_theme_chunks(
#                     recs_for_theme, batch_size, overlap, tiny_threshold
#                 )
#                 total_items = len(recs_for_theme)
#                 if is_tiny_flag:
#                     tiny_themes.append((theme_label, recs_for_theme))
#                     planned_per_theme.append((theme_label, [], True, total_items))
#                 else:
#                     planned_per_theme.append((theme_label, chunks, False, total_items))
#
#             merged_tiny_batches = _merge_tiny_themes(tiny_themes, batch_size)
#
#             for (theme_label, chunks, is_tiny_flag, total_items) in planned_per_theme:
#                 if is_tiny_flag:
#                     continue
#
#                 theme_batch_count = max(1, len(chunks))
#                 batch_idx_local = 1
#
#                 for chunk_payload in chunks:
#                     etype_majority = _majority_evidence_type(chunk_payload)
#
#                     # --- per-theme batch: analysis_prompt + combined_prompt (framework-aware, only add user extra when user_prompt non-empty) ---
#                     framework_flag = True if framework_analysis is None else bool(framework_analysis)
#                     analysis_prompt = ""
#                     if framework_flag:
#                         analysis_prompt = analysis_prompts[
#                             {
#                                 "layer1_mode": (
#                                     "temporal" if route_str.startswith(("date_range", "year"))
#                                     else ("author" if route_str.startswith("author") else "theme")
#                                 ),
#                                 "rq": rq_key or "",
#                                 "layer1_key": layer1_key,
#                                 "theme_label": theme_label,
#                                 "framework_analysis": True,
#                             }
#                         ]
#                         if isinstance(prompt, str) and prompt.strip() and isinstance(user_hint,
#                                                                                      str) and user_hint.strip():
#                             analysis_prompt = analysis_prompt.rstrip() + "\n\nEXTRA CONTEXT FROM USER (do not override structure):\n" + user_hint.strip()
#
#                     writer_rules = PYR_L1_PROMPT.format(
#                         research_question=rq_key or "(no RQ)",
#                         overarching_theme=theme_label,
#                         evidence_type=etype_majority,
#                     )
#
#                     route_context = (
#                         "ROUTE CONTEXT (do not include this heading or bullet text in the output HTML):\n"
#                         f"- route={route_str}\n"
#                         f"- layer1_key={layer1_key}\n"
#                         f"- rq={rq_key}\n"
#                         f"- theme={theme_label}\n"
#                         f"- evidence_type={etype_majority}\n\n"
#                         "PAYLOAD(JSON) DESCRIPTION:\n"
#                         "You will receive a JSON array named PAYLOAD(JSON). Each item has:\n"
#                         "  • \"direct_quote\" (verbatim text),\n"
#                         "  • \"paraphrase\" (researcher paraphrase),\n"
#                         "  • \"researcher_comment\" (analytic note),\n"
#                         "  • \"theme\" (the item's potential theme),\n"
#                         "  • \"item_key\" (unique source ID),\n"
#                         "  • \"direct_quote_id\" (unique anchor ID).\n\n"
#                         "Use those fields as evidence when writing.\n\n"
#                     )
#
#                     combined_prompt = (
#                                           (analysis_prompt.rstrip() + "\n\n") if (
#                                                       framework_flag and isinstance(analysis_prompt,
#                                                                                     str) and analysis_prompt.strip()) else ""
#                                       ) + route_context + writer_rules
#
#                     def _slug(s: str) -> str:
#                         """
#                         ###1. lowercase
#                         ###2. keep [a-z0-9]+ and convert others to single '-'
#                         ###3. trim leading/trailing '-'
#                         """
#                         import re
#                         s2 = (s or "").lower()
#                         s2 = re.sub(r"[^a-z0-9]+", "-", s2)
#                         s2 = re.sub(r"-{2,}", "-", s2)
#                         return s2.strip("-")
#
#                     batch_meta = {
#                         "layer1_key": layer1_key,
#                         "layer2_key": rq_key,
#                         "theme_label": theme_label,
#                         "layer_structure": route_str,
#                         "theme_total": total_items,
#                         "batch_index": batch_idx_local,
#                         "batch_count": theme_batch_count,
#                         "theme_counts_in_layer2": theme_counts_ordered,
#                         "batch_size_limit": batch_size,
#                         "overlap_slack": overlap,
#                         "merged_theme_breakdown": None,
#                         "collection_suffix": f"{_slug(layer1_key)}__{_slug(route_str)}__b{batch_idx_local:02d}",
#                         "collection_route_index": f"{_slug(route_str)}__b{batch_idx_local:02d}",
#                     }
#
#                     chunk_payload_norm = [
#                         {
#                             **(r or {}),
#                             "direct_quote": (r.get("direct_quote") or ""),
#                             "paraphrase": (r.get("paraphrase") or ""),
#                             "researcher_comment": (r.get("researcher_comment") or ""),
#                             "theme": (r.get("theme") or r.get("payload_theme") or r.get(
#                                 "potential_theme") or "(unspecified)"),
#                             "potential_theme": (r.get("potential_theme") or ""),
#                             "item_key": (r.get("item_key") or ""),
#                             "direct_quote_id": (r.get("direct_quote_id") or ""),
#                         }
#                         for r in (chunk_payload or [])
#                     ]
#
#                     final_batches.append(
#                         {
#                             "metadata": batch_meta,
#                             "prompt": combined_prompt,
#                             "analysis_prompt": analysis_prompt,
#                             "writer_prompt": writer_rules,
#                             "payloads": chunk_payload_norm,
#                         }
#                     )
#
#                     batch_idx_local += 1
#
#             for merged_payloads, breakdown_map in merged_tiny_batches:
#                 etype_majority = _majority_evidence_type(merged_payloads)
#                 theme_label_for_display = "(merged_small_themes)"
#
#                 analysis_prompt = analysis_prompts[
#                     {
#                         "layer1_mode": "temporal" if route_str.startswith(("date_range", "year")) else (
#                             "author" if route_str.startswith("author") else "theme"
#                         ),
#                         "rq": rq_key or "",
#                         "layer1_key": layer1_key,
#                         "theme_label": theme_label_for_display,
#                         "framework_analysis": True if framework_analysis is None else bool(framework_analysis),
#                     }
#                 ]
#                 if isinstance(user_hint, str) and user_hint.strip():
#                     analysis_prompt = (
#                         analysis_prompt.rstrip()
#                         + "\n\nEXTRA CONTEXT FROM USER (do not override structure):\n"
#                         + user_hint.strip()
#                     )
#
#                 writer_rules = PYR_L1_PROMPT.format(
#                     research_question=rq_key or "(no RQ)",
#                     overarching_theme=theme_label_for_display,
#                     evidence_type=etype_majority,
#                 )
#
#                 route_context = (
#                     "ROUTE CONTEXT (do not include this heading or bullet text in the output HTML):\n"
#                     f"- route={route_str}\n"
#                     f"- layer1_key={layer1_key}\n"
#                     f"- rq={rq_key}\n"
#                     f"- theme={theme_label_for_display}\n"
#                     f"- evidence_type={etype_majority}\n\n"
#                     "PAYLOAD(JSON) DESCRIPTION:\n"
#                     "You will receive a JSON array named PAYLOAD(JSON). Each item has:\n"
#                     "  • \"direct_quote\" (verbatim text),\n"
#                     "  • \"paraphrase\" (researcher paraphrase),\n"
#                     "  • \"researcher_comment\" (analytic note),\n"
#                     "  • \"theme\" (the item's potential theme),\n"
#                     "  • \"item_key\" (unique source ID),\n"
#                     "  • \"direct_quote_id\" (unique anchor ID).\n\n"
#                     "Use those fields as evidence when writing.\n\n"
#                 )
#
#                 combined_prompt = analysis_prompt.rstrip() + "\n\n" + route_context + writer_rules
#
#                 def _slug(s: str) -> str:
#                     """
#                     ###1. lowercase
#                     ###2. keep [a-z0-9]+ and convert others to single '-'
#                     ###3. trim leading/trailing '-'
#                     """
#                     import re
#                     s2 = (s or "").lower()
#                     s2 = re.sub(r"[^a-z0-9]+", "-", s2)
#                     s2 = re.sub(r"-{2,}", "-", s2)
#                     return s2.strip("-")
#
#                 batch_meta = {
#                     "layer1_key": layer1_key,
#                     "layer2_key": rq_key,
#                     "theme_label": theme_label_for_display,
#                     "layer_structure": route_str,
#                     "theme_total": sum(breakdown_map.values()),
#                     "batch_index": None,
#                     "batch_count": None,
#                     "theme_counts_in_layer2": theme_counts_ordered,
#                     "batch_size_limit": batch_size,
#                     "overlap_slack": overlap,
#                     "merged_theme_breakdown": breakdown_map,
#                     "collection_suffix": f"{_slug(layer1_key)}__{_slug(route_str)}__merged",
#                     "collection_route_index": f"{_slug(route_str)}__merged",
#                 }
#
#                 final_batches.append(
#                     {
#                         "metadata": batch_meta,
#                         "prompt": combined_prompt,
#                         "analysis_prompt": analysis_prompt,
#                         "writer_prompt": writer_rules,
#                         "payloads": [
#                             {
#                                 **(r or {}),
#                                 "direct_quote": (r.get("direct_quote") or ""),
#                                 "paraphrase": (r.get("paraphrase") or ""),
#                                 "researcher_comment": (r.get("researcher_comment") or ""),
#                                 "theme": (r.get("theme") or r.get("payload_theme") or r.get(
#                                     "potential_theme") or "(unspecified)"),
#                                 "potential_theme": (r.get("potential_theme") or ""),
#                                 "item_key": (r.get("item_key") or ""),
#                                 "direct_quote_id": (r.get("direct_quote_id") or ""),
#                                 "author_summary": (r.get("author_summary") or ""),
#                                 "first_author_last": (r.get("first_author_last") or ""),
#                                 "year": (r.get("year") or ""),
#                                 "title": (r.get("title") or ""),
#                                 "source": (r.get("source") or r.get("publicationTitle") or ""),
#                                 "url": (r.get("url") or ""),
#                                 "page": (r.get("page") or ""),
#                                 "section_title": (r.get("section_title") or ""),
#                                 "section_text": (r.get("section_text") or ""),
#                                 "score_bucket": (r.get("score_bucket") or ""),
#                                 "relevance_score": (
#                                     r.get("relevance_score") if r.get("relevance_score") is not None else ""),
#                                 "payload_json": (r.get("payload_json") or ""),
#                                 "route": (r.get("route") or ""),
#                                 "gold_theme": (r.get("gold_theme") or ""),
#                                 "rq_question": (r.get("rq_question") or r.get("_rq_question") or ""),
#                                 "overarching_theme": (r.get("overarching_theme") or r.get("_overarching_theme") or ""),
#                             }
#                             for r in (chunk_payload or [])
#                         ],
#                     }
#                 )
#
#                 # ... later (merged_tiny_batches) ...
#
#                 final_batches.append(
#                     {
#                         "metadata": batch_meta,
#                         "prompt": combined_prompt,
#                         "analysis_prompt": analysis_prompt,
#                         "writer_prompt": writer_rules,
#                         "payloads": [
#                             {
#                                 **(r or {}),
#                                 "direct_quote": (r.get("direct_quote") or ""),
#                                 "paraphrase": (r.get("paraphrase") or ""),
#                                 "researcher_comment": (r.get("researcher_comment") or ""),
#                                 "theme": (r.get("theme") or r.get("payload_theme") or r.get(
#                                     "potential_theme") or "(unspecified)"),
#                                 "potential_theme": (r.get("potential_theme") or ""),
#                                 "item_key": (r.get("item_key") or ""),
#                                 "direct_quote_id": (r.get("direct_quote_id") or ""),
#                                 "author_summary": (r.get("author_summary") or ""),
#                                 "first_author_last": (r.get("first_author_last") or ""),
#                                 "year": (r.get("year") or ""),
#                                 "title": (r.get("title") or ""),
#                                 "source": (r.get("source") or r.get("publicationTitle") or ""),
#                                 "url": (r.get("url") or ""),
#                                 "page": (r.get("page") or ""),
#                                 "section_title": (r.get("section_title") or ""),
#                                 "section_text": (r.get("section_text") or ""),
#                                 "score_bucket": (r.get("score_bucket") or ""),
#                                 "relevance_score": (
#                                     r.get("relevance_score") if r.get("relevance_score") is not None else ""),
#                                 "payload_json": (r.get("payload_json") or ""),
#                                 "route": (r.get("route") or ""),
#                                 "gold_theme": (r.get("gold_theme") or ""),
#                                 "rq_question": (r.get("rq_question") or r.get("_rq_question") or ""),
#                                 "overarching_theme": (r.get("overarching_theme") or r.get("_overarching_theme") or ""),
#                             }
#                             for r in (merged_payloads or [])
#                         ],
#                     }
#                 )
#
#         layer1_overview.append({"layer1_key": layer1_key, "rqs": rq_overview_list})
#
#     return {
#         "route": route_str,
#         "batch_size": batch_size,
#         "overlap": overlap,
#         "total_batches": len(final_batches),
#         "layer1_overview": layer1_overview,
#         "batches": final_batches,
#     }

class _R2Config(BaseModel):
    gold_placeholder: str = "NA"
    split_by_date: bool = False
    dates: str = ""


from typing import Optional, Dict, Any, Literal
from pydantic import BaseModel, Field
class Round2BatchingArgs(BaseModel):
    grouped: Dict[str, Any]
    batch_size: int
    overlap: int
    prompt: str = Field(default="")
    analysis_mode: Literal["temporal", "author", "theme"] = Field(
        default="theme",
        description="Select the Round-1 analysis lens to reuse."
    )
    layer1_key: Optional[str] = Field(
        default=None,
        description="Timeframe (temporal) or author (author); unused for theme"
    )
    round2: Literal["paragraphs", "sections"] = Field(
        default="paragraphs",
        description="Round-2 route: 'paragraphs' (default) or 'sections'."
    )

import re

from typing import Any, Dict, List, Optional, Tuple, Literal
from collections import OrderedDict

def choose_hierarchical_strategy() -> str:
    """
    ###1. Decide between flat and hierarchical packing for R2
    ###2. Explain why multi-level (non-recursive) merge is saner here
    """
    return "hierarchical_iterative"

def plan_hierarchical_chunks_example(records, min_chars: int = 50000, max_chars: int = 60000):
    """
    ###1. Sketch only: show how you would pack by levels without deep recursion
    ###2. Group by tag → potential_theme → gold_theme → rq while filling up to caps

    This is *illustrative*, not wired into your current code.
    """
    from collections import defaultdict

    def _html_len(rec):
        html = (
            rec.get("section_html")
            or rec.get("paragraph_html")
            or rec.get("section_text")
            or ""
        )
        return len(str(html))

    buckets_by_level = {
        "tag": defaultdict(list),
        "potential_theme": defaultdict(list),
        "gold_theme": defaultdict(list),
        "rq": defaultdict(list),
    }

    for rec in records or []:
        if not isinstance(rec, dict):
            continue
        tag = (rec.get("tag") or "").strip() or "(no_tag)"
        pot = (rec.get("potential_theme") or "").strip() or "(no_potential_theme)"
        gold = (rec.get("gold_theme") or "").strip() or "(no_gold_theme)"
        rq = (rec.get("rq") or "").strip() or "(no_rq)"

        buckets_by_level["tag"][(rq, gold, pot, tag)].append(rec)
        buckets_by_level["potential_theme"][(rq, gold, pot)].append(rec)
        buckets_by_level["gold_theme"][(rq, gold)].append(rec)
        buckets_by_level["rq"][(rq,)].append(rec)

    used_ids = set()
    chunks = []

    def _bucket_records(key, level_key):
        out = []
        for rec in buckets_by_level[level_key].get(key, []):
            cid = rec.get("section_custom_id") or rec.get("custom_id") or id(rec)
            if cid in used_ids:
                continue
            used_ids.add(cid)
            out.append(rec)
        return out

    def _emit_chunk(recs):
        if not recs:
            return
        chunks.append(recs)

    # pass 1: tags
    for key in sorted(buckets_by_level["tag"].keys()):
        recs = _bucket_records(key, "tag")
        if not recs:
            continue
        total = sum(_html_len(r) for r in recs)
        if total >= min_chars or total >= max_chars:
            _emit_chunk(recs)
        else:
            # leave for higher levels to absorb
            pass

    # pass 2: potential_theme
    for key in sorted(buckets_by_level["potential_theme"].keys()):
        recs = _bucket_records(key, "potential_theme")
        if not recs:
            continue
        total = sum(_html_len(r) for r in recs)
        if total >= min_chars or total >= max_chars:
            _emit_chunk(recs)
        else:
            pass

    # pass 3: gold_theme
    for key in sorted(buckets_by_level["gold_theme"].keys()):
        recs = _bucket_records(key, "gold_theme")
        if not recs:
            continue
        total = sum(_html_len(r) for r in recs)
        if total >= min_chars or total >= max_chars:
            _emit_chunk(recs)
        else:
            pass

    # pass 4: rq (last resort – whatever is left)
    for key in sorted(buckets_by_level["rq"].keys()):
        recs = _bucket_records(key, "rq")
        if not recs:
            continue
        _emit_chunk(recs)

    return chunks


def batching_widget_data_round2(
        *,
        grouped: Dict[str, Any],
        prompt: str,
        analysis_mode: Literal["temporal", "author", "theme"] = "theme",
        layer1_key: Optional[str] = None,
        round2: Literal["paragraphs", "sections"] = "paragraphs",
        framework_analysis: bool = False,
) -> Dict[str, Any]:
    """
    BATCHING FOR ROUND-2.

    If round2=="paragraphs": paragraph synthesis (legacy behaviour).
    If round2=="sections":   WHOLE-section synthesis; effective batch size is halved before scaling.
    Single-section buckets in sections-mode are treated as leftovers instead of R2 synthesis jobs.
    """
    _ = Round2BatchingArgs(
        grouped=grouped,
        batch_size=0,
        overlap=0,
        prompt=prompt or "",
        analysis_mode=analysis_mode,
        layer1_key=layer1_key,
        round2=round2,
    )
    MAX_CHARS_PARAGRAPHS = 50000
    MAX_CHARS_SECTIONS = 60000
    adjusted_size = MAX_CHARS_PARAGRAPHS if round2 == "paragraphs" else MAX_CHARS_SECTIONS
    overlap_eff = 1000
    tiny_threshold = 0

    def _sanitize_user_hint(h: str) -> str:
        h2 = (h or "").strip()
        if not h2:
            return ""
        if len(h2) > 2000:
            h2 = h2[:2000]
        lower = h2.lower()
        bad_frags = [
            "ignore previous instructions",
            "disregard the above instructions",
            "you are no longer",
            "you are chatgpt",
            "system prompt",
            "<|endoftext|>",
        ]
        flagged = any(f in lower for f in bad_frags)
        if flagged:
            return "[USER CONTEXT / NOT A SYSTEM OVERRIDE]\n" + h2
        return h2

    user_hint = _sanitize_user_hint(prompt or "")
    all_groups = grouped.get("groups") or {}
    tag_stats_map = grouped.get("tag_stats") or {}

    tiny_threshold = 0

    def _balanced_sizes(total: int, k: int) -> List[int]:
        sizes: List[int] = []
        remaining = total
        buckets_left = k
        while buckets_left > 0:
            sz = (remaining + buckets_left - 1) // buckets_left
            sizes.append(sz)
            remaining -= sz
            buckets_left -= 1
        return sizes

    def _plan_chunks(recs: List[Dict[str, Any]]) -> Tuple[List[List[Dict[str, Any]]], bool]:
        """
        ###1. for round2='sections' cap by total HTML characters, not count
        ###2. for round2='paragraphs' keep legacy count-based logic
        """
        records = list(recs or [])
        if not records:
            return ([], True)

        if str(round2).strip().lower() == "sections":
            chunks: List[List[Dict[str, Any]]] = []
            current: List[Dict[str, Any]] = []
            current_chars = 0

            for rec in records:
                if not isinstance(rec, dict):
                    continue

                html_val = rec.get("section_html") or rec.get("paragraph_html") or rec.get("html") or ""
                html_s = str(html_val)
                length = len(html_s)

                if not current:
                    current.append(rec)
                    current_chars = length
                    continue

                if current_chars + length <= adjusted_size:
                    current.append(rec)
                    current_chars += length
                else:
                    chunks.append(current)
                    current = [rec]
                    current_chars = length

            if current:
                chunks.append(current)

            if not chunks:
                return ([], True)
            return (chunks, False)

        n = len(records)
        if n <= 0:
            return ([], True)

        limit_single = adjusted_size + overlap_eff
        double_limit = adjusted_size * 2

        if tiny_threshold > 0 and n < tiny_threshold:
            return ([], True)

        if n <= limit_single:
            return ([records], False)

        if n < double_limit:
            mid = (n + 1) // 2
            return ([records[:mid], records[mid:]], False)

        safe_size = adjusted_size if adjusted_size > 0 else 1
        base_batches = max(1, n // safe_size)
        if base_batches < 2:
            base_batches = 2

        sizes = _balanced_sizes(n, base_batches)
        out: List[List[Dict[str, Any]]] = []
        i = 0
        for sz in sizes:
            out.append(records[i:i + sz])
            i += sz
        return (out, False)

    CONTRACT_BASE_PARAS = (
        "<STRUCTURE / OUTPUT CONTRACT>\n"
        "INPUT (PARAGRAPHS(JSON))\n"
        "• Each item:\n"
        "    – paragraph_html (a single <p>…</p> with anchors already inserted)\n"
        "    – tags (semicolon-separated, may be empty)\n"
        "    – meta_json (JSON: rq, gold_theme, evidence_type, etc.)\n"
        "• paragraph_html may include <!-- coverage used=… unused=… -->.\n"
        "• Anchors already include href, data-key, title, and data-quote-id.\n\n"
        "EVIDENCE COVERAGE\n"
        "• Treat all paragraphs as in-scope evidence.\n"
        "• Engage each paragraph at least once; support reliance with its anchors.\n"
        "• Cluster claims by shared meaning inside the current TAG/RQ/Theme frame.\n"
        "• Note convergence, disagreement, and ambiguity.\n\n"
        "CITATION / ANCHOR RULES\n"
        "• Allowed anchor form (do not alter attributes):\n"
        "  <a href=\"KEY\" data-key=\"ITEM_KEY\" title=\"DIRECT_QUOTE_ID\" data-quote-id=\"DIRECT_QUOTE_ID\"></a>\n"
        "• Do not invent new href, data-key, title, or data-quote-id.\n"
        "• Reuse anchors exactly as they appear; never add text inside <a>…</a>.\n"
        "• No fabricated or paraphrased quotes.\n"
        "• APA-style references must remain outside anchors.\n"
        "• Do not duplicate a (data-key, data-quote-id) pair inside one sentence.\n\n"
        "TASK\n"
        "• Produce an integrated HTML synthesis organised by TAG within the RQ + Overarching Theme.\n"
        "• Merge overlapping claims while keeping distinct evidence and disagreements.\n"
        "• Support each analytic move with anchors from the input paragraphs.\n\n"
        "OUTPUT (raw HTML only — no Markdown, no lists)\n"
        "• Start with one heading that reflects the cross-section synthesis:\n"
        "  <h3 id=\"section-title\">[title that reflects the whole section]</h3>\n"
        "• Then write analytic <p>…</p> paragraphs that weave together claims and evidence\n"
        "  from multiple sections until all included material is covered.\n"
        "  – Use data-tags=\"t1;t2;…\" on each <p> when tags are inferable; choose 1–3 concise tags.\n"
        "  – Include at least one anchor, drawn from the input HTML, in every analytic paragraph.\n"
        "  – Aim for a total section length of at least 1,000 words, using as many analytic paragraphs as needed.\n"
        "  – You may create subsections with <h4>…</h4> where this improves structure; each subsection should reach\n"
        "    at least 500 words across its paragraphs.\n"
        "  Example:\n"
        "  <p id=\"p1\" data-tags=\"technical;thresholds\">Topic sentence. Evidence-led synthesis across sections … "
        "<a href=\"KEY\" data-key=\"ITEM_KEY\" title=\"DIRECT_QUOTE_ID\" data-quote-id=\"DIRECT_QUOTE_ID\"></a> "

        "<a href=\"KEY2\" data-key=\"ITEM_KEY_2\" title=\"DIRECT_QUOTE_ID_2\" data-quote-id=\"DIRECT_QUOTE_ID_2\"></a></p>\n"
        "• After thematic paragraphs, add a conclusive paragraph (2–3 sentences) with EXACT id:\n"
        "  <p id=\"conclusion\">Synthesis across paragraphs; state the strongest regularities, main disagreements, and implications and the overral response to the research question.</p>\n"
        "• If needed, append a residuals paragraph with EXACT id for marginal or outlier material:\n"
        "  <p id=\"residual\">Residual coverage: brief reason these items do not fit the main synthesis; still cite them with anchors.</p>\n"
        "• Finally append a coverage ledger comment over all SECTIONS(JSON):\n"
        "  <!-- coverage used=[comma-separated data-key values used at least once] unused=[comma-separated data-key values not used] -->\n\n"
        "QUALITY CHECK (apply before returning)\n"
        "• Every analytic paragraph has at least one anchor.\n"
        "• Each analytic paragraph normally cites at least three distinct sources (three different data-key values).\n"
        "• Each <p> includes data-tags with 1–3 informative tags where they can be inferred.\n"
        "• Each analytic paragraph is around 100–150 words with a topic sentence, evidence-led\n"
        "  development using anchors from multiple sections where possible, and a linking or closing sentence.\n"
        "• No invented keys: every data-key, title, and data-quote-id matches an anchor in the input section_html.\n"
        "• Exactly one <h3 id=\"section-title\">, one <p id=\"conclusion\">, and an optional <p id=\"residual\">.\n"
        "• The coverage ledger reflects actual usage: \"used\" lists all data-key values that appear in any output anchor;\n"
        "  \"unused\" = payload keys − used.\n"
        "<STRUCTURE / OUTPUT CONTRACT/>"

    )

    CONTRACT_BASE_SECS = (
        "<STRUCTURE / OUTPUT CONTRACT>\n"
        "INPUT (SECTIONS(JSON))\n"
        "• You receive SECTIONS(JSON).\n"
        "  Each item:\n"
        "    – section_html (multi-paragraph HTML block with anchors already inserted).\n"
        "• section_html may contain coverage comments:\n"
        "  <!-- coverage used=… unused=… -->\n"
        "• Anchors inside section_html already have href, data-key, title, and data-quote-id set.\n\n"
        "EVIDENCE COVERAGE (mandatory)\n"
        "• Treat every SECTIONS(JSON) item as included evidence for the current TAG/RQ/Theme bucket.\n"
        "• Cross-synthesise across all sections in the payload; do not drop sections as out of scope\n"
        "  without explaining this briefly in a residual paragraph.\n"
        "• When you rely on a claim from a section, show that reliance with at least one anchor\n"
        "  drawn from that section’s HTML.\n\n"
        "CITATION / ANCHOR RULES\n"
        "• You receive anchors with this shape (do not alter attributes):\n"
        "  <a href=\"KEY\" data-key=\"ITEM_KEY\" title=\"DIRECT_QUOTE_ID\" data-quote-id=\"DIRECT_QUOTE_ID\"></a>\n"
        "• Do NOT invent new href, data-key, title, or data-quote-id values; only reuse anchors\n"
        "  that exist in the input section_html payloads.\n"
        "• Preserve each anchor’s href, data-key, title, and data-quote-id exactly when you move it.\n"
        "• Do not fabricate or paraphrase text inside the anchor.\n"
        "• If you mention APA-style citations (Author, Year), keep them outside the <a> tags.\n"
        "• Within a single sentence, do not repeat the same (data-key, data-quote-id) pair.\n\n"
        "TASK (ROUND-2 CROSS-SYNTHESIS)\n"
        "• Cross-synthesise whole sections that share the current tag within the same RQ and gold_theme.\n"
        "• Identify consistent findings, key disagreements, and gaps across sections.\n"
        "• Aim for integrated analysis; quote sparingly but support important claims with anchors.\n"
        "• Keep existing non-citation hyperlinks; do not remove or alter them.\n\n"
        "OUTPUT (raw HTML only — no Markdown, no lists)\n"
        "• Start with one heading that reflects the cross-section synthesis:\n"
        "  <h3 id=\"section-title\">[title that reflects the whole section]</h3>\n"
        "• Then write analytic <p>…</p> paragraphs that weave together claims and evidence\n"
        "  from multiple sections until all included material is covered.\n"
        "  – Use data-tags=\"t1;t2;…\" on each <p> when tags are inferable; choose 1–3 concise tags.\n"
        "  – Include at least one anchor, drawn from the input HTML, in every analytic paragraph.\n"
        "  – Aim for a total section length of at least 1,000 words, using as many analytic paragraphs as needed.\n"
        "  – You may create subsections with <h4>…</h4> where this improves structure; each subsection should reach\n"
        "    at least 500 words across its paragraphs.\n"
        "  Example:\n"
        "  <p id=\"p1\" data-tags=\"technical;thresholds\">Topic sentence. Evidence-led synthesis across sections … "
        "<a href=\"KEY\" data-key=\"ITEM_KEY\" title=\"DIRECT_QUOTE_ID\" data-quote-id=\"DIRECT_QUOTE_ID\"></a> "
        "<a href=\"KEY2\" data-key=\"ITEM_KEY_2\" title=\"DIRECT_QUOTE_ID_2\" data-quote-id=\"DIRECT_QUOTE_ID_2\"></a>.</p>\n"
        "• After thematic paragraphs, add a conclusive paragraph (2–3 sentences) with EXACT id:\n"
        "  <p id=\"conclusion\">Synthesis across paragraphs; state the strongest regularities, main disagreements, and implications.</p>\n"
        "• If needed, append a residuals paragraph with EXACT id for marginal or outlier material:\n"
        "  <p id=\"residual\">Residual coverage: brief reason these items do not fit the main synthesis; still cite them with anchors.</p>\n"
        "• Finally append a coverage ledger comment over all SECTIONS(JSON):\n"
        "  <!-- coverage used=[comma-separated data-key values used at least once] unused=[comma-separated data-key values not used] -->\n\n"
        "QUALITY CHECK (apply before returning)\n"
        "• Every analytic paragraph has at least one anchor.\n"
        "• Each analytic paragraph normally cites at least three distinct sources (three different data-key values).\n"
        "• Each <p> includes data-tags with 1–3 informative tags where they can be inferred.\n"
        "• Each analytic paragraph is around 100–150 words with a topic sentence, evidence-led\n"
        "  development using anchors from multiple sections where possible, and a linking or closing sentence.\n"
        "• No invented keys: every data-key, title, and data-quote-id matches an anchor in the input section_html.\n"
        "• Exactly one <h3 id=\"section-title\">, one <p id=\"conclusion\">, and an optional <p id=\"residual\">.\n"
        "• The coverage ledger reflects actual usage: \"used\" lists all data-key values that appear in any output anchor;\n"
        "  \"unused\" = payload keys − used.\n"
        "<STRUCTURE / OUTPUT CONTRACT/>"
    )

    def _writer_contract(rq: str, gold: str, tag_label: str) -> str:
        base = CONTRACT_BASE_PARAS if round2 == "paragraphs" else CONTRACT_BASE_SECS
        return (
            base
            # + "\nCONTEXT REMINDERS:\n"
            # + f"- RQ: {rq}\n"
            # + f"- Overarching Theme: {gold}\n"
        )

    def _analysis_for_round2(rq: str, gold: str, tag_label: str) -> str:
        """
        ###1. build base analysis header (framework vs fallback)
        ###2. normalise spacing and deduplicate lines
        """
        analysis_mode_local = analysis_mode
        layer1_key_local = layer1_key
        round2_mode = str(round2).strip().lower()

        inp = AnalysisPromptInput(
            layer1_mode=analysis_mode_local,
            rq=rq,
            layer1_key=layer1_key_local,
            theme_label=gold if analysis_mode_local == "theme" else (gold or ""),
            framework_analysis=framework_analysis,
        )

        base_default = (
            "SYSTEMATIC-REVIEW MODE:\n"
            "Treat each item as data. Report patterns, disagreements, and the strength of support.\n\n"
            "REVIEW RATIONALE:\n"
            "• Use only information present in the supplied HTML.\n"
            "• Keep empirical description separate from author commentary.\n"
            "• Treat convergent findings as provisional regularities, not universal rules.\n"
            "• When evidence conflicts, state the disagreement and its context.\n"
            "• Note missing perspectives, weak support, and unresolved questions.\n\n"
            "CITATION AND ANCHOR RULES:\n"
            "• Citations arrive as <a> elements with href, data-key, and title attributes.\n"
            "• Do not invent item keys or direct_quote_ids; do not change attribute values.\n"
            "• If a sentence already has anchors, keep every <a> and preserve their order.\n"
            "• When a sentence draws on several sources, give each source its own anchor.\n"
            "• Treat anchors as fixed metadata; move only the surrounding prose.\n\n"
            "REPORTING GUIDELINES:\n"
            "• Anchor every substantive claim to at least one citation present in the input HTML.\n"
            "• Present evidence with explicit attribution, using academic phrasing.\n"
            "  – Prefer formulations such as \"authors ITEM_KEY1 and ITEM_KEY2 argue that cyber war is coming\" or\n"
            "    \"several scholars (ITEM_KEY1; ITEM_KEY2) treat cyber war as imminent\" instead of bare claims like\n"
            "    \"cyber war is coming\" with citations tacked on.\n"
            "  – When referring to a body of work, use formulations such as \"according to several scholars\" or\n"
            "    \"the literature suggests\" and then support the sentence with concrete anchors to specific ITEM_KEY values.\n"
            "• Describe clusters of evidence, isolated claims, and ambiguous items.\n"
            "• Distinguish descriptive reporting from evaluative commentary.\n"
            "• Avoid normative judgment unless a source states it explicitly.\n\n"
            "CONSTRAINT:\n"
            "Use only hyperlinks and anchors already present in the input HTML as evidentiary support and keep\n"
            "href, data-key, and title attributes unchanged."
        )

        analysis_prompts_local: Dict[Any, str] = analysis_prompts
        if framework_analysis:
            base_text = analysis_prompts_local.get(inp, base_default)
        else:
            base_text = base_default

        tail = "paragraphs" if round2_mode == "paragraphs" else "sections"
        tag_str = str(tag_label).strip() if tag_label is not None else "(merged_small_tags)"
        tag_line = ""
        blocks = [base_text.strip(), tag_line.strip()]

        seen: Set[str] = set()
        out_lines: List[str] = []
        for blk in blocks:
            for ln in blk.splitlines():
                k = ln.strip()
                if not k:
                    out_lines.append("")
                    continue
                if k in seen:
                    continue
                seen.add(k)
                out_lines.append(ln)
            out_lines.append("")

        compact: List[str] = []
        blanks = 0
        for ln in out_lines:
            if ln.strip():
                blanks = 0
                compact.append(ln)
            else:
                blanks += 1
                if blanks <= 2:
                    compact.append("")
        return "\n".join(compact).strip()

    def _make_prompt_full(rq: str, gold: str, tag_label: str) -> Tuple[str, str]:
        """
        ###1. assemble analysis part via _analysis_for_round2
        ###2. append writer contract
        ###3. append optional user hint block
        """
        analysis_part = _analysis_for_round2(rq, gold, tag_label)
        writer_part = _writer_contract(rq, gold, tag_label)
        analysis_part_s = str(analysis_part or "").rstrip()
        writer_part_s = str(writer_part or "").rstrip()
        full_prompt = analysis_part_s + "\n\n" + writer_part_s
        hint = user_hint.strip()
        if hint:
            full_prompt += "\n\nEXTRA CONTEXT (do not override structure):\n" + hint
        return analysis_part_s, full_prompt

    def _route_context_block(
            route_value: str,
            rq_label: str,
            theme_label: str,
            level2_route_label: str,
            level2_group_label: str,
    ) -> str:
        rv = (route_value or "").strip()
        rq_s = (rq_label or "").strip()
        theme_s = (theme_label or "").strip()
        lvl2 = (level2_route_label or "").strip()
        lvl2_lab = (level2_group_label or "").strip()
        return (
            "<ROUTE CONTEXT>\n"
            f"- timeframe={rv}\n"
            f"- rq={rq_s}\n"
            f"- theme={theme_s}\n"

            "CONTEXT/>\n\n"
        )

    final_batches: List[Dict[str, Any]] = []
    layer1_overview: List[Dict[str, Any]] = []
    leftovers_singletons: List[Dict[str, Any]] = []
    quotes_index: Dict[str, str] = grouped.get("direct_quotes") or {}

    def _strip_coverage(html: str) -> str:
        text = html or ""
        if not text:
            return ""
        return text

    def _remove_bare_urls(text: str) -> str:
        value = text or ""
        if not value:
            return ""
        return value

    def _ensure_anchor_contract(html: str) -> str:
        """
        ###1. pass-through for Round-2 sections; do not risk stripping content
        """
        s = str(html or "")
        if not s.strip():
            return ""
        return s

    def _infer_tags_from_p(html: str) -> List[str]:
        found: List[str] = []
        for m in re.finditer(r'<p[^>]*\sdata-tags="([^"]+)"[^>]*>', html or "", flags=0):
            raw = m.group(1)
            for t in raw.split(";"):
                tt = t.strip()
                if tt and tt not in found:
                    found.append(tt)
        return found

    def _clean_section_record(rec: Dict[str, Any], fallback_tag: str) -> Dict[str, Any]:
        """
        ###1. pick best available HTML (section_html, paragraph_html, section_text)
        ###2. normalise anchors
        ###3. hydrate tags or fall back to bucket tag
        """
        base = rec if isinstance(rec, dict) else {}

        raw_section = base.get("section_html")
        if not isinstance(raw_section, str) or not raw_section.strip():
            raw_section = base.get("paragraph_html") or base.get("section_text") or ""

        html0 = str(raw_section or "")
        html1 = _ensure_anchor_contract(html0)

        if not html1.strip() and html0.strip():
            print(
                "[R2 WARN] _clean_section_record lost HTML during cleaning; "
                "falling back to original. route_value='"
                + str(base.get("route_value"))
                + "' rq='"
                + str(base.get("rq"))
                + "' gold='"
                + str(base.get("gold_theme"))
                + "' tag='"
                + str(base.get("tags"))
                + "'"
            )
            html1 = html0

        tags_list = _infer_tags_from_p(html1)
        tag_field = ";".join(tags_list) if tags_list else fallback_tag

        out = dict(base)
        out["section_html"] = html1
        out["tags"] = tag_field
        return out

    route_str = grouped.get("route", "rq → gold_theme → tag")

    print("[R2 batching] grouped keys:", sorted(list(grouped.keys())))
    print("[R2 batching] route_str raw:", str(route_str))

    groups_top = grouped.get("groups") or {}
    print(
        "[R2 batching] groups type=",
        type(groups_top),
        "top_level_count=",
        len(groups_top),
    )
    sample_level1 = list(groups_top.keys())[:5]
    print("[R2 batching] level1 keys (route_value layer):", sample_level1)

    def _level2_route_for_current(route_str_local: str) -> str:
        s = (route_str_local or "").strip()
        if not s:
            return "gold_theme"
        parts = [p.strip() for p in s.split("→") if p.strip()]
        if not parts:
            return "gold_theme"
        head = parts[0]
        candidates = ["rq", "gold_theme", "potential_theme", "tags"]
        for cand in candidates:
            if cand != head and cand in parts:
                return cand
        if len(parts) >= 2:
            return parts[1]
        return "gold_theme"

    base_level2_route = _level2_route_for_current(route_str)

    for route_value_key, rq_map in groups_top.items():
        if not isinstance(rq_map, dict):
            continue

        for rq_key, gold_map in rq_map.items():
            if not isinstance(gold_map, dict):
                continue

            rq_overview_list: List[Dict[str, Any]] = []

            for gold_key, tag_map in gold_map.items():
                if not isinstance(tag_map, dict):
                    continue

                stats_key_str = str(route_value_key) + " | " + str(rq_key) + " | " + str(gold_key)
                stats_map = tag_stats_map.get(stats_key_str) or {}
                level2_route_this_gold = base_level2_route

                sorted_tags = sorted(
                    tag_map.keys(),
                    key=lambda t: (-int(stats_map.get(t, 0)), str(t).lower()),
                )

                all_recs_for_gold: List[Dict[str, Any]] = []
                for t in sorted_tags:
                    recs_t = list(tag_map.get(t, []) or [])
                    if recs_t:
                        all_recs_for_gold.extend(recs_t)

                if round2 == "sections":
                    limit_bucket = adjusted_size + overlap_eff
                    if limit_bucket <= 0:
                        limit_bucket = adjusted_size
                    if limit_bucket <= 0:
                        limit_bucket = 1

                    rq_counts_all: Dict[str, int] = {}
                    for rec in all_recs_for_gold:
                        if not isinstance(rec, dict):
                            continue
                        rq_raw = rec.get("rq")
                        if isinstance(rq_raw, str):
                            rq_s = rq_raw.strip()
                        else:
                            rq_s = ""
                        if rq_s:
                            rq_counts_all[rq_s] = rq_counts_all.get(rq_s, 0) + 1

                    rq_uniques_sorted: List[Tuple[str, int]] = []
                    for k, v in rq_counts_all.items():
                        rq_uniques_sorted.append((k, v))
                    rq_uniques_sorted.sort(key=lambda kv: (-kv[1], kv[0]))

                    if rq_uniques_sorted:
                        rq_label = rq_uniques_sorted[0][0]
                    else:
                        rq_label = "(no RQ)"

                    if len(all_recs_for_gold) > limit_bucket:
                        print(
                            "level 2 > attempting route 1>rq for route_value='"
                            + str(route_value_key)
                            + "' gold_theme='"
                            + str(gold_key)
                            + "'"
                        )
                        print("rq uniques > count=" + str(len(rq_uniques_sorted)))
                        for idx_rq, (rq_val, rq_cnt) in enumerate(rq_uniques_sorted, start=1):
                            print(
                                "  rq "
                                + str(idx_rq)
                                + " | rq_label='"
                                + str(rq_val)
                                + "' items="
                                + str(rq_cnt)
                            )

                        max_rq_bucket_size = 0
                        for _, rq_cnt in rq_uniques_sorted:
                            if rq_cnt > max_rq_bucket_size:
                                max_rq_bucket_size = rq_cnt

                        if max_rq_bucket_size <= limit_bucket and rq_uniques_sorted:
                            print(
                                "level 2 success with route 1 rq (max_bucket_size="
                                + str(max_rq_bucket_size)
                                + " <= limit="
                                + str(limit_bucket)
                                + ")"
                            )
                            rq_buckets: Dict[str, List[Dict[str, Any]]] = {}
                            for rec in all_recs_for_gold:
                                rq_raw = rec.get("rq")
                                if isinstance(rq_raw, str):
                                    rq_val = rq_raw.strip()
                                else:
                                    rq_val = ""
                                if not rq_val:
                                    rq_val = "(no RQ)"
                                if rq_val not in rq_buckets:
                                    rq_buckets[rq_val] = []
                                rq_buckets[rq_val].append(rec)

                            print(
                                "level 2 route 1>rq groups for route_value='"
                                + str(route_value_key)
                                + "' gold_theme='"
                                + str(gold_key)
                                + "':"
                            )
                            for idx_rq, (rq_val, rq_cnt) in enumerate(rq_uniques_sorted, start=1):
                                print(
                                    "  group "
                                    + str(idx_rq)
                                    + " | rq_label='"
                                    + str(rq_val)
                                    + "' items="
                                    + str(rq_cnt)
                                )

                            level2_route_this_gold = "rq"
                            tag_map = {}
                            stats_map = {}
                            for rq_val, recs_rq in rq_buckets.items():
                                tag_map[rq_val] = recs_rq
                                stats_map[rq_val] = len(recs_rq)

                            sorted_tags = sorted(
                                tag_map.keys(),
                                key=lambda t: (-int(stats_map.get(t, 0)), str(t).lower()),
                            )

                rq_overview_list.append(
                    {
                        "gold_theme": gold_key,
                        "tags": OrderedDict((t, int(stats_map.get(t, 0))) for t in sorted_tags),
                    }
                )

                # replacement
                MIN_CHARS = 50000
                MAX_CHARS = 60000

                def _section_char_len(rec: Dict[str, Any]) -> int:
                    html_val = rec.get("section_html") or rec.get("paragraph_html") or ""
                    return len(str(html_val))

                def _slim_payload_for_kind(
                        kind: str,
                        records: List[Dict[str, Any]],
                ) -> List[Dict[str, Any]]:
                    """
                    ###1. for round2='sections' keep only section_html
                    ###2. for round2='paragraphs' keep only paragraph_html
                    """
                    out: List[Dict[str, Any]] = []
                    mode = str(kind or "").strip().lower()
                    for rec in records:
                        if not isinstance(rec, dict):
                            continue
                        if mode == "sections":
                            html_val = rec.get("section_html") or ""
                            out.append({"section_html": str(html_val)})
                        elif mode == "paragraphs":
                            html_val = rec.get("paragraph_html") or ""
                            out.append({"paragraph_html": str(html_val)})
                        else:
                            html_val = rec.get("section_html") or rec.get("paragraph_html") or ""
                            out.append({"html": str(html_val)})
                    return out

                def _split_unit_if_needed(tag_label: str, recs: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
                    """
                    ###1. split a tag-unit into smaller units if its total chars > MAX_CHARS
                    """
                    total_chars = 0
                    for r in recs:
                        total_chars += _section_char_len(r)

                    if total_chars <= MAX_CHARS:
                        return [{"tag": tag_label, "recs": recs, "chars": total_chars}]

                    out_units: List[Dict[str, Any]] = []
                    current: List[Dict[str, Any]] = []
                    current_chars = 0
                    for r in recs:
                        c = _section_char_len(r)
                        if current and current_chars + c > MAX_CHARS:
                            out_units.append(
                                {"tag": tag_label, "recs": current, "chars": current_chars}
                            )
                            current = []
                            current_chars = 0
                        current.append(r)
                        current_chars += c
                    if current:
                        out_units.append(
                            {"tag": tag_label, "recs": current, "chars": current_chars}
                        )
                    return out_units

                def _make_char_buckets_for_gold(
                        tag_map_local: Dict[str, List[Dict[str, Any]]],
                        sorted_tag_labels: List[str],
                ) -> List[Tuple[List[Dict[str, Any]], List[str]]]:
                    """
                    ###1. build units at tag level
                    ###2. split oversized tag units
                    ###3. greedily merge units to reach [MIN_CHARS, MAX_CHARS] where possible
                    """
                    units: List[Dict[str, Any]] = []
                    for t_label in sorted_tag_labels:
                        recs_t = list(tag_map_local.get(t_label, []) or [])
                        if not recs_t:
                            continue
                        units.extend(_split_unit_if_needed(t_label, recs_t))

                    gold_total_chars = 0
                    for u in units:
                        gold_total_chars += int(u.get("chars", 0))

                    if gold_total_chars <= MAX_CHARS and units:
                        merged_recs: List[Dict[str, Any]] = []
                        merged_tags: List[str] = []
                        for u in units:
                            merged_recs.extend(u["recs"])
                            merged_tags.append(u["tag"])
                        return [(merged_recs, merged_tags)]

                    buckets: List[Tuple[List[Dict[str, Any]], List[str]]] = []
                    cur_recs: List[Dict[str, Any]] = []
                    cur_tags: List[str] = []
                    cur_chars = 0

                    for u in units:
                        u_chars = int(u.get("chars", 0))
                        if cur_recs and cur_chars >= MIN_CHARS and cur_chars + u_chars > MAX_CHARS:
                            buckets.append((cur_recs, cur_tags))
                            cur_recs = []
                            cur_tags = []
                            cur_chars = 0

                        cur_recs.extend(u["recs"])
                        cur_tags.append(u["tag"])
                        cur_chars += u_chars

                    if cur_recs:
                        buckets.append((cur_recs, cur_tags))

                    return buckets

                stats_key_str = str(route_value_key) + " | " + str(rq_key) + " | " + str(gold_key)
                stats_map = tag_stats_map.get(stats_key_str) or {}
                level2_route_this_gold = base_level2_route

                sorted_tags = sorted(
                    tag_map.keys(),
                    key=lambda t: (-int(stats_map.get(t, 0)), str(t).lower()),
                )

                rq_overview_list.append(
                    {
                        "gold_theme": gold_key,
                        "tags": OrderedDict((t, int(stats_map.get(t, 0))) for t in sorted_tags),
                    }
                )

                buckets_for_gold = _make_char_buckets_for_gold(tag_map, sorted_tags)

                for b_idx, (payload, tag_labels) in enumerate(buckets_for_gold, start=1):
                    cleaned_payload: List[Dict[str, Any]] = []
                    nonempty_html = 0
                    empty_html = 0

                    fallback_tag_label = ";".join(
                        sorted({str(t) for t in tag_labels})
                    ) if tag_labels else "(merged_small_tags)"

                    for rec in payload:
                        rec_clean = _clean_section_record(rec, fallback_tag=fallback_tag_label)
                        html_clean = str(rec_clean.get("section_html") or "")
                        if html_clean.strip():
                            cleaned_payload.append(rec_clean)
                            nonempty_html += 1
                        else:
                            empty_html += 1

                    total_chars_bucket = 0
                    for rec in cleaned_payload:
                        total_chars_bucket += _section_char_len(rec)

                    if not cleaned_payload:
                        print(
                            "[R2 WARN] skipping empty bucket for route_value='"
                            + str(route_value_key)
                            + "' rq_key='"
                            + str(rq_key)
                            + "' gold='"
                            + str(gold_key)
                            + "'"
                        )
                        continue

                    route_value = ""
                    rv0_any = cleaned_payload[0].get("route_value")
                    if isinstance(rv0_any, str):
                        route_value = rv0_any.strip()
                    elif rv0_any is not None:
                        route_value = str(rv0_any).strip()
                    if not route_value:
                        if isinstance(route_value_key, str):
                            route_value = route_value_key
                        else:
                            route_value = str(route_value_key)

                    rq_for_meta = ""
                    rq_counts: Dict[str, int] = {}
                    for rec in cleaned_payload:
                        if not isinstance(rec, dict):
                            continue
                        rv_rq = rec.get("rq")
                        if isinstance(rv_rq, str):
                            rq_s = rv_rq.strip()
                        else:
                            rq_s = ""
                        if rq_s:
                            rq_counts[rq_s] = rq_counts.get(rq_s, 0) + 1

                    if rq_counts:
                        items = list(rq_counts.items())
                        items.sort(key=lambda kv: (-kv[1], kv[0]))
                        rq_for_meta = items[0][0]

                    if not rq_for_meta:
                        if isinstance(rq_key, str):
                            rq_for_meta = rq_key
                        else:
                            rq_for_meta = str(rq_key)

                    tag_label_for_meta = fallback_tag_label if fallback_tag_label else "(merged_small_tags)"

                    analysis_part, full_prompt = _make_prompt_full(
                        rq_for_meta, gold_key, tag_label_for_meta
                    )
                    route_ctx = _route_context_block(
                        route_value,
                        rq_for_meta,
                        gold_key,
                        level2_route_this_gold,
                        tag_label_for_meta,
                    )
                    full_prompt = route_ctx + full_prompt

                    meta = {
                        "layer_structure": route_str,
                        "rq": rq_for_meta,
                        "gold_theme": gold_key,
                        "tag": tag_label_for_meta,
                        "batch_index": b_idx,
                        "batch_count": len(buckets_for_gold),
                        "adjusted_batch_size": adjusted_size,
                        "overlap": overlap_eff,
                        "round2": round2,
                        "route_value": route_value,
                        "level2_route": level2_route_this_gold,
                        "approx_chars": total_chars_bucket,
                    }

                    slim_payload = _slim_payload_for_kind(str(round2), cleaned_payload)
                    final_batches.append(
                        {
                            "metadata": meta,
                            "prompt": full_prompt,
                            "analysis_prompt": analysis_part,
                            "writer_prompt": "",
                            "payloads": slim_payload,
                        }
                    )

    print(
        "[R2 batching] effective_batch_size="
        + str(adjusted_size)
        + " overlap="
        + str(overlap_eff)
    )
    def _dedupe_sections_global(
            batches: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """
        ###1. ensure each unique section_html appears only once across all batches
        ###2. recompute approx_chars per batch after dedupe
        ###3. drop empty batches
        """
        import hashlib

        seen_hashes: Set[str] = set()
        out_batches: List[Dict[str, Any]] = []

        for batch in batches:
            md = batch.get("metadata") or {}
            payload = list(batch.get("payloads") or [])

            filtered: List[Dict[str, Any]] = []
            total_chars = 0

            for rec in payload:
                if not isinstance(rec, dict):
                    continue

                html_val = rec.get("section_html") or rec.get("paragraph_html") or rec.get("html") or ""
                html_s = str(html_val)
                if not html_s:
                    continue

                html_hash = hashlib.md5(html_s.encode("utf-8")).hexdigest()[:16]
                if html_hash in seen_hashes:
                    continue

                seen_hashes.add(html_hash)
                filtered.append(rec)
                total_chars += _section_char_len(rec)

            if filtered:
                md2 = dict(md)
                md2["approx_chars"] = int(total_chars)

                b2 = dict(batch)
                b2["metadata"] = md2
                b2["payloads"] = filtered
                out_batches.append(b2)

        return out_batches

    if round2 == "sections":
        print("[R2 dedupe] enforcing unique sections globally")
        final_batches = _dedupe_sections_global(final_batches)

        MIN_CHARS_BUCKET = 50000
        MAX_CHARS_BUCKET = adjusted_size if adjusted_size > 0 else 60000

        def _coalesce_small_batches_by_route_value(
                batches: List[Dict[str, Any]],
                min_chars: int,
                max_chars: int,
        ) -> List[Dict[str, Any]]:
            """
            ###1. normalise approx_chars per batch (recompute from payload if missing/zero)
            ###2. group batches by route_value
            ###3. within each route_value, greedily merge until hitting max_chars
                and avoid sub-min buckets when route total >= min_chars
            """
            grouped_local: Dict[str, List[Dict[str, Any]]] = {}

            for b in batches:
                md = b.get("metadata") or {}
                rv = str(md.get("route_value") or "")
                if rv not in grouped_local:
                    grouped_local[rv] = []
                grouped_local[rv].append(b)

            merged_batches: List[Dict[str, Any]] = []

            for rv, group_batches in grouped_local.items():
                enriched: List[Tuple[Dict[str, Any], int]] = []
                total_chars_rv = 0

                for b in group_batches:
                    md = b.get("metadata") or {}
                    approx_val = md.get("approx_chars")

                    if isinstance(approx_val, int) and approx_val > 0:
                        chars = approx_val
                    else:
                        chars = 0
                        for rec in b.get("payloads") or []:
                            if not isinstance(rec, dict):
                                continue
                            html_val = rec.get("section_html") or rec.get("paragraph_html") or rec.get("html") or ""
                            chars += len(str(html_val))

                    md_local = dict(md)
                    md_local["approx_chars"] = int(chars)

                    b_local = dict(b)
                    b_local["metadata"] = md_local

                    enriched.append((b_local, chars))
                    total_chars_rv += chars

                if total_chars_rv <= 0:
                    for b_local, _chars in enriched:
                        merged_batches.append(b_local)
                    continue

                route_must_allow_small = total_chars_rv < min_chars

                current_batch: Optional[Dict[str, Any]] = None
                current_payload: List[Dict[str, Any]] = []
                current_chars = 0
                current_meta: Dict[str, Any] = {}

                for b_local, chars in enriched:
                    payload_list = list(b_local.get("payloads") or [])

                    if current_batch is None:
                        current_batch = dict(b_local)
                        current_payload = list(payload_list)
                        current_chars = chars
                        current_meta = dict(b_local.get("metadata") or {})
                        continue

                    new_total = current_chars + chars

                    if new_total <= max_chars:
                        current_payload.extend(payload_list)
                        current_chars = new_total
                        continue

                    if (not route_must_allow_small) and current_chars < min_chars:
                        current_payload.extend(payload_list)
                        current_chars = new_total
                        continue

                    current_meta["approx_chars"] = int(current_chars)
                    current_batch["metadata"] = current_meta
                    current_batch["payloads"] = current_payload
                    merged_batches.append(current_batch)

                    current_batch = dict(b_local)
                    current_payload = list(payload_list)
                    current_chars = chars
                    current_meta = dict(b_local.get("metadata") or {})

                if current_batch is not None:
                    current_meta["approx_chars"] = int(current_chars)
                    current_batch["metadata"] = current_meta
                    current_batch["payloads"] = current_payload
                    merged_batches.append(current_batch)

            print(
                "[R2 COALESCE] original_batches="
                + str(len(batches))
                + " merged_batches="
                + str(len(merged_batches))
            )
            return merged_batches

            print(
                "[R2 COALESCE] original_batches="
                + str(len(batches))
                + " merged_batches="
                + str(len(merged_batches))
            )
            return merged_batches

        final_batches = _coalesce_small_batches_by_route_value(
            final_batches,
            MIN_CHARS_BUCKET,
            MAX_CHARS_BUCKET,
        )


    rv_item_counts: Dict[str, int] = {}
    route_batches: Dict[str, List[Dict[str, Any]]] = {}

    for batch in final_batches:
        md = batch.get("metadata") or {}
        rv = str(md.get("route_value") or "")
        if not rv:
            rv = "(no_route_value)"

        cnt = len(batch.get("payloads") or [])
        rv_item_counts[rv] = rv_item_counts.get(rv, 0) + cnt

        if rv not in route_batches:
            route_batches[rv] = []
        route_batches[rv].append(batch)

    print("[R2 route_value] uniques and counts:")
    for rv in sorted(route_batches.keys()):
        print("  " + rv + " | items=" + str(rv_item_counts.get(rv, 0)))

    stats_tree: Dict[str, Dict[str, Any]] = {}
    route_modes: Dict[str, set] = {}

    for rv, batches_for_rv in route_batches.items():
        if rv not in stats_tree:
            stats_tree[rv] = {}
        if rv not in route_modes:
            route_modes[rv] = set()

        for batch in batches_for_rv:
            md = batch.get("metadata") or {}
            level2_mode = str(md.get("level2_route") or "(unset)")
            rq_md = str(md.get("rq") or "(unspecified)")
            gold_md = str(md.get("gold_theme") or "(unspecified)")
            pot_md = str(md.get("potential_theme") or "(unspecified)")
            tag_md = str(md.get("tag") or "(unspecified)")

            if level2_mode == "rq":
                level2_key = rq_md
            elif level2_mode == "gold_theme":
                level2_key = gold_md
            elif level2_mode == "potential_theme":
                level2_key = pot_md
            elif level2_mode == "tags":
                level2_key = tag_md
            else:
                level2_key = gold_md + " / " + tag_md

            cnt = len(batch.get("payloads") or [])

            level2_map = stats_tree[rv]
            if level2_key not in level2_map:
                level2_map[level2_key] = {
                    "items": 0,
                    "batches": 0,
                    "gold": {},
                }

            level2_entry = level2_map[level2_key]
            level2_entry["items"] = int(level2_entry["items"]) + int(cnt)
            level2_entry["batches"] = int(level2_entry["batches"]) + 1

            gold_map = level2_entry["gold"]
            if gold_md not in gold_map:
                gold_map[gold_md] = {
                    "items": 0,
                    "batches": 0,
                }

            gold_entry = gold_map[gold_md]
            gold_entry["items"] = int(gold_entry["items"]) + int(cnt)
            gold_entry["batches"] = int(gold_entry["batches"]) + 1

            route_modes[rv].add(level2_mode)

    print("[R2 batching] grouping tree by route_value and level2_route:")
    for rv in sorted(stats_tree.keys()):
        level2_map = stats_tree[rv]
        modes = sorted(route_modes.get(rv, set()))
        total_items_rv = 0
        total_batches_rv = 0

        for level2_entry in level2_map.values():
            total_items_rv += int(level2_entry.get("items", 0))
            total_batches_rv += int(level2_entry.get("batches", 0))

        print("  route_value=" + rv)
        print(
            "    level2_route="
            + "/".join(modes)
            + " buckets="
            + str(len(level2_map))
            + " items="
            + str(total_items_rv)
            + " batches="
            + str(total_batches_rv)
        )

        for level2_key, level2_entry in sorted(
                level2_map.items(),
                key=lambda kv: (-int(kv[1].get("items", 0)), kv[0]),
        ):
            items_l2 = int(level2_entry.get("items", 0))
            batches_l2 = int(level2_entry.get("batches", 0))
            print(
                "      "
                + str(level2_key)
                + " => items="
                + str(items_l2)
                + " buckets="
                + str(batches_l2)
            )

            gold_map = level2_entry.get("gold") or {}
            if not gold_map:
                continue

            for gold_label, gold_entry in sorted(
                    gold_map.items(),
                    key=lambda kv: (-int(kv[1].get("items", 0)), kv[0]),
            ):
                items_g = int(gold_entry.get("items", 0))
                batches_g = int(gold_entry.get("batches", 0))
                print(
                    "        "
                    + str(gold_label)
                    + " => items="
                    + str(items_g)
                    + " buckets="
                    + str(batches_g)
                )

    print("[R2 batching] batches and payload composition:")
    print("[R2 batching] total_batches=" + str(len(final_batches)))

    return {
        "route": route_str,
        "batch_size_effective": adjusted_size,
        "overlap": overlap_eff,
        "total_batches": len(final_batches),
        "layer1_overview": layer1_overview,
        "batches": final_batches,
        "batches_by_route_value": route_batches,
        "round2": round2,
    }

