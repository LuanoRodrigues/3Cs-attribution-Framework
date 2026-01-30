// Auto-generated. Run "npm run generate:templates" after editing templates/.
import type { TemplateDefinition } from "./types.ts";

export const templateDefinitions: TemplateDefinition[] = [
  {
    "id": "academic_report",
    "label": "Academic Report Outline",
    "description": "Structured cover page for formal university reports.",
    "document": {
      "type": "doc",
      "content": [
        {
          "type": "heading",
          "attrs": {
            "level": 1
          },
          "content": [
            {
              "type": "text",
              "text": "Academic Report"
            }
          ]
        },
        {
          "type": "paragraph",
          "content": [
            {
              "type": "text",
              "text": "Prepared by "
            },
            {
              "type": "merge_tag",
              "attrs": {
                "key": "AUTHOR"
              }
            }
          ]
        },
        {
          "type": "paragraph",
          "content": [
            {
              "type": "text",
              "text": "Department: "
            },
            {
              "type": "merge_tag",
              "attrs": {
                "key": "DEPARTMENT"
              }
            }
          ]
        }
      ]
    }
  },
  {
    "id": "conference_note",
    "label": "Conference Summary",
    "description": "Quick capture format for panel discussions.",
    "document": {
      "type": "doc",
      "content": [
        {
          "type": "heading",
          "attrs": {
            "level": 1
          },
          "content": [
            {
              "type": "text",
              "text": "Conference Summary"
            }
          ]
        },
        {
          "type": "paragraph",
          "content": [
            {
              "type": "text",
              "text": "Date: "
            },
            {
              "type": "merge_tag",
              "attrs": {
                "key": "EVENT_DATE"
              }
            }
          ]
        },
        {
          "type": "paragraph",
          "content": [
            {
              "type": "merge_tag",
              "attrs": {
                "key": "EVENT_DETAILS"
              }
            }
          ]
        }
      ]
    }
  },
  {
    "id": "cyber_policy_journal",
    "label": "Cyber Policy Journal",
    "description": "Research-first layout for technology governance papers.",
    "document": {
      "type": "doc",
      "content": [
        {
          "type": "heading",
          "attrs": {
            "level": 1
          },
          "content": [
            {
              "type": "text",
              "text": "Cyber Policy Journal"
            }
          ]
        },
        {
          "type": "paragraph",
          "content": [
            {
              "type": "text",
              "text": "Abstract: "
            },
            {
              "type": "merge_tag",
              "attrs": {
                "key": "ABSTRACT"
              }
            }
          ]
        },
        {
          "type": "heading",
          "attrs": {
            "level": 2
          },
          "content": [
            {
              "type": "text",
              "text": "Recommendations"
            }
          ]
        },
        {
          "type": "paragraph",
          "content": [
            {
              "type": "text",
              "text": "1. Maintain strong encryption policies."
            }
          ]
        }
      ]
    }
  },
  {
    "id": "international_affairs",
    "label": "International Affairs",
    "description": "Two-column briefing with bold call-to-action.",
    "document": {
      "type": "doc",
      "content": [
        {
          "type": "heading",
          "attrs": {
            "level": 1
          },
          "content": [
            {
              "type": "text",
              "text": "International Affairs Brief"
            }
          ]
        },
        {
          "type": "paragraph",
          "content": [
            {
              "type": "text",
              "text": "Focus: "
            },
            {
              "type": "text",
              "marks": [
                {
                  "type": "strong"
                }
              ],
              "text": "Security policy"
            }
          ]
        },
        {
          "type": "paragraph",
          "content": [
            {
              "type": "text",
              "text": "Key takeaways go here with bullet-style statements."
            }
          ]
        }
      ]
    }
  }
];
