"""Compatibility shim for the pipeline package.

Use:
    from Research.pipeline.runner import TEIAResearchPipeline
or:
    from Research.pipeline import TEIAResearchPipeline
"""

from Research.pipeline import (  # noqa: F401
    ArticleStage,
    OutlineStage,
    PipelineConfig,
    PolishStage,
    ResearchStage,
    TEIAResearchPipeline,
)

__all__ = [
    "TEIAResearchPipeline",
    "PipelineConfig",
    "ResearchStage",
    "OutlineStage",
    "ArticleStage",
    "PolishStage",
]
