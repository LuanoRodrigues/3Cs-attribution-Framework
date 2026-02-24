

## 0) Scope and coding unit

### 0.1 Review scope
This codebook is designed to extract and code **social science** research (including IR, security studies, IPE, STS, political communication, law/policy studies used in IR debates) that addresses **large language models (LLMs)** or closely related **generative AI** systems **in relation to international politics and/or cyber politics**.

**“Cyber politics”** here includes cyber conflict, coercion, espionage, sabotage, influence operations, cyber norms and international law, cyber capacity building, governance of digital infrastructure, and the politics of attribution, defense, and resilience.

### 0.2 Units of coding
- **Study-level (required):** one row per study/article/report.
- **Claim-level (optional but recommended):** excerpts for (i) causal mechanisms, (ii) key empirical claims, (iii) policy prescriptions, (iv) definitions of key terms.

### 0.3 Multi-label rules
Unless explicitly marked “single-select”, codes may be **multi-select**.

### 0.4 Evidence vs inference discipline
For each major substantive claim you record, separate:
- **What the paper states (verbatim/excerpt)** vs
- **What you infer (your interpretation)**

---

## 1) Screening and eligibility (PRISMA-friendly)

### 1.1 Eligibility decision (single-select)
- **ELIGIBLE:** includes IR/cyber politics content *and* meaningful LLM/generative AI content.
- **INELIGIBLE:** exclude from synthesis.

### 1.2 Exclusion reason (single-select; only if INELIGIBLE)
- **EXC-A:** Not about LLMs/generative AI (AI is unrelated or absent)
- **EXC-B:** Not about international relations / international politics (purely domestic with no international dimension)
- **EXC-C:** Not about cyber politics / digital conflict/governance (LLMs discussed but outside cyber/digital politics)
- **EXC-D:** Not social science / IR-relevant (e.g., purely technical with no political implications)
- **EXC-E:** Not scholarly/credible source for review (blog/opinion with insufficient provenance, unless your protocol includes grey literature)
- **EXC-F:** Duplicate / earlier version superseded
- **EXC-G:** Not accessible / insufficient information

---

## 2) Administrative and bibliographic metadata (study-level)

### 2.1 Citation fields (open text)
- **CITATION_KEY:** short key (e.g., `AuthorYear_Journal`)
- **TITLE**
- **AUTHORS**
- **YEAR**
- **VENUE:** journal / conference / book / policy report
- **DOI/URL**
- **TYPE:** article / book chapter / working paper / report

### 2.2 Disciplinary location (multi-select)
- **DISC-IR**
- **DISC-SecurityStudies**
- **DISC-IPE**
- **DISC-ComparativePolitics**
- **DISC-PoliticalCommunication**
- **DISC-STS**
- **DISC-LawPolicy**
- **DISC-CS/InfoSec (policy-facing)**
- **DISC-Other:** (specify)

### 2.3 Region / cases (multi-select + open text)
- **REGION-Global**
- **REGION-US**
- **REGION-Europe**
- **REGION-China**
- **REGION-Russia**
- **REGION-MiddleEast**
- **REGION-Africa**
- **REGION-LatinAmerica**
- **REGION-IndoPacific**
- **REGION-Other:** (specify)
- **CASE_NOTES:** named disputes, incidents, campaigns, organizations

### 2.4 Time window studied (open text)
- **TIME_START** / **TIME_END** (years, if applicable)
- **EVENT_ANCHOR:** e.g., “post-ChatGPT release”, “Ukraine war”, “SolarWinds”

---

## 3) Substantive focus: cyber politics (study-level)

### 3.1 Cyber politics domain (multi-select)
- **CYB-CONFLICT:** interstate cyber operations, cyber war, escalation
- **CYB-COERCION/DETERRENCE:** threats, signaling, punishment/denial logics
- **CYB-ESPIONAGE:** intelligence collection, intrusion campaigns
- **CYB-SABOTAGE/DISRUPTION:** critical infrastructure disruption, ICS, ransomware as disruption
- **CYB-INFLUENCE/IO:** information operations, propaganda, psychological ops, narrative warfare
- **CYB-CRIME-POLITICS:** state-crime nexus, geopolitical implications of cybercrime ecosystems
- **CYB-ATTRIBUTION:** technical/political attribution, evidentiary standards, blame assignment
- **CYB-NORMS/LAW:** UN GGE/OEWG, IHL, sovereignty, due diligence, norm entrepreneurship
- **CYB-GOVERNANCE:** platform governance, standards, institutional design, multistakeholder politics
- **CYB-CAPACITY/DEVELOPMENT:** cyber capacity building, digital sovereignty, dependency
- **CYB-SUPPLYCHAIN/INFRA:** cloud, chips, telecoms, backbone infrastructure politics
- **CYB-DEFENSE/RESILIENCE:** national cyber strategy, incident response institutions, resilience policies

### 3.2 Security object (multi-select)
- **OBJ-StateSecurity**
- **OBJ-RegimeSecurity**
- **OBJ-SocietalSecurity**
- **OBJ-EconomicSecurity**
- **OBJ-CriticalInfrastructure**
- **OBJ-InformationIntegrity**
- **OBJ-HumanSecurity**
- **OBJ-Other:** (specify)

---

## 4) Technology focus: LLMs and generative AI (study-level)

### 4.1 AI system type (multi-select)
- **AI-LLM:** text-centric large language model
- **AI-Multimodal:** text+image/audio/video
- **AI-GenImage**
- **AI-GenAudio/Voice**
- **AI-AgenticSystems:** tool-using agents, autonomous workflows
- **AI-OtherGenAI:** (specify)
- **AI-NotSpecified:** “AI” broadly, unclear model class

### 4.2 LLM role in the argument (multi-select)
- **ROLE-OffenseEnabler:** enables or scales offensive cyber operations (phishing, social engineering, exploit development assistance, OPSEC)
- **ROLE-DefenseEnabler:** improves defense (triage, detection engineering, incident response, secure coding)
- **ROLE-InfluenceEnabler:** enables influence operations (content generation, persona ops, microtargeting narratives)
- **ROLE-DecisionSupport:** used by decision-makers (analysis, intelligence support, diplomacy, crisis management)
- **ROLE-InfrastructureDependency:** reliance on frontier models/API providers as strategic dependency
- **ROLE-TargetOfAttack:** model supply chain, data poisoning, prompt injection, model theft, inference attacks
- **ROLE-GovernanceObject:** model governance, regulation, standards, audits, export controls
- **ROLE-MeasurementObject:** focus on evaluations, benchmarks, capability measurement as politics
- **ROLE-Other:** (specify)

### 4.3 Threat model / harm type (multi-select)
- **HARM-Misinformation/Disinformation**
- **HARM-Fraud/Scams**
- **HARM-Phishing/SocialEngineering**
- **HARM-Malware/ExploitAssistance**
- **HARM-Privacy/DataLeakage**
- **HARM-Bias/Discrimination**
- **HARM-Reliability/Hallucination**
- **HARM-Opacity/Accountability**
- **HARM-EscalationRisk:** misperception, rapid action, crisis instability
- **HARM-Proliferation:** diffusion to non-state actors, capability leveling
- **HARM-Other:** (specify)

### 4.4 Capability posture (single-select)
- **CAP-Transformative:** claims of major discontinuity/strategic revolution
- **CAP-Incremental:** improvements but within existing political logic
- **CAP-Uncertain/Contested:** emphasizes unknowns, measurement problems
- **CAP-Skeptical:** downplays or rejects major strategic effect

### 4.5 Evidence about capabilities (multi-select)
- **EVID-Benchmarks/Evals**
- **EVID-IncidentReports**
- **EVID-ExpertElicitation**
- **EVID-CaseStudy**
- **EVID-Theoretical/Speculative**
- **EVID-Other:** (specify)

---

## 5) International relations theory and analytical framing (study-level)

### 5.1 Theoretical lens (multi-select)
- **IR-Realism:** balance of power, security dilemma, deterrence, relative gains
- **IR-Liberalism/Institutionalism:** institutions, regimes, cooperation under anarchy
- **IR-Constructivism:** norms, identity, discourse, legitimacy
- **IR-StrategicStudies:** coercion, escalation, military innovation
- **IR-IPE:** global value chains, dependency, sanctions, industrial policy
- **IR-BureaucraticPolitics/OrgTheory:** agencies, principal-agent, implementation
- **IR-DomesticPolitics:** regime type, coalitions, public opinion shaping foreign policy
- **IR-ScienceTechStudies:** co-production, sociotechnical imaginaries, expertise politics
- **IR-Critical:** postcolonial, feminist, critical security studies, power/knowledge
- **IR-Other:** (specify)
- **IR-NoneExplicit:** no explicit theory

### 5.2 Level of analysis (multi-select)
- **LOA-Systemic**
- **LOA-Dyadic/Interstate**
- **LOA-Domestic/State**
- **LOA-Organizational**
- **LOA-Individual/Elite**
- **LOA-SocioTechnical/Ecosystem**

### 5.3 Key IR concepts invoked (multi-select)
- **CONCEPT-Deterrence**
- **CONCEPT-Escalation**
- **CONCEPT-StrategicStability**
- **CONCEPT-Power/Capability**
- **CONCEPT-Interdependence**
- **CONCEPT-Sovereignty**
- **CONCEPT-Norms/Legitimacy**
- **CONCEPT-AlliancePolitics**
- **CONCEPT-Sanctions/ExportControls**
- **CONCEPT-Attribution/Signaling**
- **CONCEPT-Other:** (specify)

---

## 6) Research design and methods (study-level)

### 6.1 Research purpose (single-select)
- **PURP-Descriptive/Mapping**
- **PURP-Explanatory/Causal**
- **PURP-Interpretive/Discourse**
- **PURP-Evaluative/PolicyAnalysis**
- **PURP-Methodological/Measurement**
- **PURP-Other:** (specify)

### 6.2 Method (multi-select)
- **METH-QualCaseStudy**
- **METH-ProcessTracing**
- **METH-ComparativeHistorical**
- **METH-QuantObservational**
- **METH-Experiment/Survey**
- **METH-ComputationalSocialScience:** text-as-data, network analysis
- **METH-FormalModel**
- **METH-Conceptual/Theoretical**
- **METH-LegalAnalysis**
- **METH-MixedMethods**
- **METH-Other:** (specify)

### 6.3 Data sources (multi-select)
- **DATA-Interviews**
- **DATA-Archival/Docs**
- **DATA-NewsMedia**
- **DATA-SocialMedia**
- **DATA-TechnicalTelemetry:** logs, malware repos (used for political inference)
- **DATA-PolicyTexts:** treaties, strategies, UN reports
- **DATA-IncidentDatabases:** e.g., breach/cyber event datasets
- **DATA-Experiments/Simulations**
- **DATA-Other:** (specify)

### 6.4 Case selection logic (single-select if empirical)
- **CASE-TheoryDriven**
- **CASE-MostLikely/LeastLikely**
- **CASE-CriticalCase**
- **CASE-Convenience**
- **CASE-NotApplicable** (non-empirical)

### 6.5 Measurement stance (single-select)
- **MEAS-Operationalized:** clear variables/indicators
- **MEAS-Partial:** some indicators but under-specified
- **MEAS-ConceptualOnly:** no measurement, purely conceptual
- **MEAS-NotApplicable**

---

## 7) Causal mechanisms and pathways (claim-level recommended)

Record each mechanism as a separate entry/excerpt when possible.

### 7.1 Mechanism family (multi-select)
- **MECH-CapabilityScaling:** LLMs reduce cost/increase speed of cyber/IO tasks
- **MECH-AccessLowering:** lowers skill barrier, expands actor set
- **MECH-QualityImprovement:** increases sophistication (linguistic, targeting, coding help)
- **MECH-OrganizationalAdoption:** bureaucratic/firm adoption changes behavior
- **MECH-InformationAsymmetry:** affects intelligence, uncertainty, misperception
- **MECH-AttributionPolitics:** changes evidentiary politics (fabrication, plausible deniability, proof standards)
- **MECH-EscalationDynamics:** crisis instability via faster OODA loops, automation bias
- **MECH-Dependency/Leverage:** strategic dependence on model providers/compute supply chains
- **MECH-NormInstitutionChange:** new rules/standards shift incentives and legitimacy
- **MECH-Other:** (specify)

### 7.2 Causal direction (single-select)
- **DIR-LLM→CyberPolitics:** LLM change drives political outcomes
- **DIR-CyberPolitics→LLM:** geopolitical competition shapes LLM development/governance
- **DIR-Bidirectional**
- **DIR-Unclear**

### 7.3 Confidence posture (single-select)
- **CONF-High:** strong empirical support
- **CONF-Medium:** some evidence, caveats
- **CONF-Low:** speculative/theoretical
- **CONF-Contested:** explicitly disputed

---

## 8) Outcomes and dependent variables (study-level)

### 8.1 Outcome type (multi-select)
- **OUT-CyberOperationFrequency**
- **OUT-CyberOperationEffectiveness**
- **OUT-CoerciveSuccess/DeterrenceFailure**
- **OUT-Escalation/ConflictIntensity**
- **OUT-AttributionSuccess/BlameDynamics**
- **OUT-InformationIntegrity/PublicOpinion**
- **OUT-InstitutionBuilding/NormAdoption**
- **OUT-AllianceCoordination**
- **OUT-EconomicStatecraft/IndustrialPolicy**
- **OUT-Resilience/DefenseCapacity**
- **OUT-Other:** (specify)

### 8.2 Reported direction of effect (single-select; if applicable)
- **EFF-Increase**
- **EFF-Decrease**
- **EFF-Conditional/Mixed**
- **EFF-Null**
- **EFF-NotEstimated**

---

## 9) Governance, policy, and normative content (study-level + claim-level)

### 9.1 Governance mechanism discussed (multi-select)
- **GOV-Regulation/Legislation**
- **GOV-Standards/Certification**
- **GOV-Audits/Evaluations**
- **GOV-Liability/Accountability**
- **GOV-ExportControls/Sanctions**
- **GOV-Transparency/Disclosure**
- **GOV-AccessControls**
- **GOV-IncidentReporting**
- **GOV-InternationalRegimes:** treaties, UN processes, plurilateral agreements
- **GOV-PrivateGovernance:** platform policies, industry self-regulation
- **GOV-Other:** (specify)

### 9.2 Normative stance (single-select)
- **NORM-PromoteDiffusion:** emphasizes benefits/innovation
- **NORM-ManageRisk:** balanced governance, “responsible” development
- **NORM-Restrict/Contain:** strong controls, moratoria, licensing
- **NORM-Sovereigntist:** emphasizes national control, strategic autonomy
- **NORM-Critical/Justice:** emphasizes power, inequity, domination
- **NORM-NotExplicit**

### 9.3 Policy prescription specificity (single-select)
- **POL-Specific:** named instruments, implementable steps
- **POL-Moderate:** general proposals with some detail
- **POL-Vague:** exhortations without instruments
- **POL-None**

### 9.4 Trade-offs acknowledged (multi-select)
- **TRD-SecurityVsOpenness**
- **TRD-PrivacyVsUtility**
- **TRD-InnovationVsOversight**
- **TRD-GlobalCooperationVsSovereignty**
- **TRD-TransparencyVsSecurity**
- **TRD-Other:** (specify)

---

## 10) Quality appraisal (optional; study-level)

> Use only if your SR protocol includes quality assessment.

### 10.1 Transparency and reproducibility (single-select)
- **QUAL-High:** clear methods + data/appendix
- **QUAL-Medium:** methods described but limited transparency
- **QUAL-Low:** methods unclear, claims unsupported

### 10.2 Evidentiary strength (single-select)
- **QUAL-Strong**
- **QUAL-Moderate**
- **QUAL-Weak**
- **QUAL-NotApplicable**

### 10.3 Limitations acknowledged (single-select)
- **LIM-Explicit**
- **LIM-Partial**
- **LIM-None**

---

## 11) Minimal extraction template (spreadsheet columns)

You can implement the codebook as a spreadsheet with these columns:

- `CITATION_KEY, TITLE, AUTHORS, YEAR, VENUE, TYPE, DOI_URL`
- `ELIGIBILITY, EXCLUSION_REASON`
- `DISCIPLINE, REGION, CASE_NOTES, TIME_START, TIME_END, EVENT_ANCHOR`
- `CYBER_DOMAIN, SECURITY_OBJECT`
- `AI_SYSTEM_TYPE, LLM_ROLE, HARM_TYPE, CAPABILITY_POSTURE, CAPABILITY_EVIDENCE`
- `THEORY_LENS, LEVEL_OF_ANALYSIS, IR_CONCEPTS`
- `RESEARCH_PURPOSE, METHODS, DATA_SOURCES, CASE_SELECTION, MEASUREMENT_STANCE`
- `OUTCOME_TYPE, EFFECT_DIRECTION`
- `GOV_MECHANISMS, NORMATIVE_STANCE, POLICY_SPECIFICITY, TRADEOFFS`
- `QUALITY_TRANSPARENCY, QUALITY_EVIDENCE, LIMITATIONS_ACK`

For claim-level extraction, add:
- `CLAIM_ID, QUOTE, PAGE, MECH_FAMILY, DIRECTION, CONFIDENCE`

---

## 12) Coding notes and decision rules

1. **Code what the study actually does, not what it promises.** If it claims “causal” but only speculates, code the method accordingly and mark confidence low.
2. **Separate “LLMs as tool” from “LLMs as governance object.”** Many papers mix both; multi-code is allowed.
3. **Attribution politics is both technical and political.** If the paper discusses proof standards, strategic ambiguity, or contestation of evidence, use `CYB-ATTRIBUTION` and `MECH-AttributionPolitics`.
4. **When in doubt on theory:** use `IR-NoneExplicit` and capture the key concepts invoked under 5.3.
5. **Prefer verbatim excerpts for mechanisms and prescriptions.** This reduces interpretive drift and improves inter-coder reliability.

---

## 13) Assumptions used to draft this codebook

- Your systematic review targets **IR-relevant social science** rather than purely technical security papers.
- The focal technology class is **LLMs / generative AI**, but the codebook tolerates broader “AI” references via `AI-NotSpecified`.
- You want a codebook that supports both **descriptive mapping** (what the literature says) and **mechanism-centric synthesis** (how authors argue LLMs matter for cyber politics).
"""