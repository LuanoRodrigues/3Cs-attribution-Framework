// Auto-generated. Run "npm run generate:templates" after editing journal_templates/.
import type { TemplateDefinition } from "./types.ts";

export const templateDefinitions: TemplateDefinition[] = [
  {
    "id": "conflict_security",
    "label": "Conflict Security",
    "description": "Template for authors submitting to the Journal of Conflict and Security Law (JCSL). This template synthesizes the available author guidance: the journal calls for abstracts of around 250 words and total article length under 9,000 words【940797253148206†L113-L116】. It uses the Oxford Standard for Citation of Legal Authorities (OSCOLA) footnote system and generally follows standard OSCOLA formatting, including double‑spaced text, 1‑inch margins and 12‑point Arial font【513106655613384†L246-L252】.",
    "document": {
      "type": "doc",
      "attrs": {
        "citationStyleId": "oscola",
        "citationLocale": "en-GB"
      },
      "content": [
        {
          "type": "heading",
          "attrs": {
            "level": 1
          },
          "content": [
            {
              "type": "text",
              "text": "Article Title"
            }
          ]
        },
        {
          "type": "paragraph",
          "content": [
            {
              "type": "text",
              "text": "Provide a concise abstract of 250–400 words summarizing the article’s argument and findings."
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
              "text": "Introduction"
            }
          ]
        },
        {
          "type": "paragraph",
          "content": [
            {
              "type": "text",
              "text": "Begin the main text using double‑spaced paragraphs. Use single quotation marks for quotations and place footnote markers at the end of sentences."
            }
          ]
        },
        {
          "type": "paragraph",
          "content": [
            {
              "type": "text",
              "text": "When citing sources, insert a superscript note number"
            },
            {
              "type": "text",
              "text": "1",
              "marks": [
                {
                  "type": "footnote"
                }
              ]
            },
            {
              "type": "text",
              "text": " and provide the full citation in the footnote following OSCOLA style."
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
              "text": "Main Section"
            }
          ]
        },
        {
          "type": "paragraph",
          "content": [
            {
              "type": "text",
              "text": "Develop your argument with appropriately structured headings and subheadings following the OSCOLA hierarchy. Keep the manuscript under 9,000 words."
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
              "text": "Conclusion"
            }
          ]
        },
        {
          "type": "paragraph",
          "content": [
            {
              "type": "text",
              "text": "Summarize the key arguments and implications. Ensure that footnotes provide complete references and that the bibliography is arranged alphabetically as per OSCOLA guidelines."
            }
          ]
        }
      ]
    },
    "metadata": {
      "documentDefaults": {
        "fontFamily": "Arial",
        "fontSizePx": 12,
        "textColor": "#0f172a",
        "headingColor": "#111827",
        "lineHeight": "double",
        "spaceBeforePx": 0,
        "spaceAfterPx": 8,
        "textAlign": "justify"
      },
      "citation": {
        "style": "OSCOLA",
        "locale": "en-GB",
        "note": "Use the OSCOLA footnote system: citations appear in numbered footnotes, with corresponding entries in a bibliography. Footnote markers are placed at the end of a sentence and separated by semicolons when citing multiple sources【513106655613384†L256-L263】. Use single quotation marks for quotations【513106655613384†L256-L263】."
      },
      "typography": {
        "headings": [
          {
            "name": "Title",
            "font": "Arial",
            "size": "16pt",
            "weight": "700",
            "case": "title",
            "alignment": "center",
            "spacing": {
              "before": "12pt",
              "after": "6pt",
              "lineHeight": "2.0"
            }
          },
          {
            "name": "Heading 1",
            "font": "Arial",
            "size": "14pt",
            "weight": "700",
            "case": "title",
            "alignment": "center",
            "spacing": {
              "before": "10pt",
              "after": "5pt",
              "lineHeight": "2.0"
            }
          },
          {
            "name": "Heading 2",
            "font": "Arial",
            "size": "13pt",
            "weight": "700",
            "case": "title",
            "alignment": "left",
            "spacing": {
              "before": "8pt",
              "after": "4pt",
              "lineHeight": "2.0"
            }
          },
          {
            "name": "Heading 3",
            "font": "Arial",
            "size": "12pt",
            "weight": "400",
            "style": "italic",
            "case": "sentence",
            "alignment": "left",
            "spacing": {
              "before": "6pt",
              "after": "3pt",
              "lineHeight": "2.0"
            }
          }
        ],
        "paragraph": {
          "font": "Arial",
          "size": "12pt",
          "lineHeight": "2.0",
          "alignment": "left",
          "color": "#000000",
          "spacing": {
            "before": "0pt",
            "after": "6pt"
          }
        },
        "abstract": {
          "font": "Arial",
          "size": "11pt",
          "lineHeight": "2.0",
          "alignment": "left",
          "style": "italic",
          "spacing": {
            "before": "0pt",
            "after": "8pt"
          }
        },
        "emphasis": [
          {
            "label": "Strong",
            "style": {
              "weight": "700",
              "color": "#002147"
            }
          },
          {
            "label": "Italic",
            "style": {
              "italic": true,
              "color": "#002147"
            }
          },
          {
            "label": "Quote",
            "style": {
              "italic": true,
              "color": "#666666"
            }
          }
        ]
      },
      "colors": {
        "accent": "#002147",
        "muted": "#666666",
        "background": "#FFFFFF"
      },
      "layout": {
        "margins": "1in",
        "gutter": "0.5in",
        "grid": "single",
        "columns": 1
      },
      "houseStyle": {
        "abstractLength": "Include an abstract of around 250 words; the call for papers notes abstracts should not exceed 400 words, and full papers should be under 9,000 words【940797253148206†L113-L116】.",
        "spacing": "Use double‑spaced text and 1‑inch margins as recommended by OSCOLA formatting guidelines【513106655613384†L246-L252】.",
        "citationNotes": "Apply OSCOLA footnotes: place superscript note numbers at the end of sentences, separate multiple citations with semicolons and use ‘ibid’ for successive citations【513106655613384†L256-L283】.",
        "headings": "Follow the OSCOLA heading hierarchy: Level 1 headings are centred, bold and capitalized; Level 2 are centred and capitalized; Level 3 are flush left, bold and capitalized; Level 4 are flush left and sentence‑style【513106655613384†L267-L274】."
      }
    }
  },
  {
    "id": "cyber_policy",
    "label": "Cyber Policy",
    "description": "Template for authors submitting to the Journal of Cyber Policy. It combines Chatham House’s editorial preferences (British punctuation and spelling) with Taylor & Francis formatting requirements such as 12‑point Times New Roman, double spacing, and one‑inch margins. Citations should follow the Chicago notes and bibliography style.",
    "document": {
      "type": "doc",
      "attrs": {
        "citationStyleId": "chicago-note-bibliography",
        "citationLocale": "en-GB"
      },
      "content": [
        {
          "type": "heading",
          "attrs": {
            "level": 1
          },
          "content": [
            {
              "type": "text",
              "text": "Article Title"
            }
          ]
        },
        {
          "type": "paragraph",
          "attrs": {
            "textAlign": "left"
          },
          "content": [
            {
              "type": "text",
              "text": "Provide a concise abstract summarizing the purpose and findings of the paper."
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
              "text": "Introduction"
            }
          ]
        },
        {
          "type": "paragraph",
          "content": [
            {
              "type": "text",
              "text": "The body of the article should be written in clear, concise prose. Use double‑spaced paragraphs with a first‑line indent and adhere to British spelling conventions. Footnote numbers appear as superscripts in the text."
            }
          ]
        },
        {
          "type": "paragraph",
          "content": [
            {
              "type": "text",
              "text": "When citing a source, insert a superscript note number"
            },
            {
              "type": "text",
              "text": "1",
              "marks": [
                {
                  "type": "footnote"
                }
              ]
            },
            {
              "type": "text",
              "text": " and list the corresponding citation in the footnote section following Chicago style."
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
              "text": "Conclusion"
            }
          ]
        },
        {
          "type": "paragraph",
          "content": [
            {
              "type": "text",
              "text": "Summarize the key findings and implications for cyber policy. Use en‑dashes for parenthetical statements and single quotation marks for quotations as specified in the house style."
            }
          ]
        }
      ]
    },
    "metadata": {
      "documentDefaults": {
        "fontFamily": "Times New Roman",
        "fontSizePx": 12,
        "textColor": "#0f172a",
        "headingColor": "#111827",
        "lineHeight": "double",
        "spaceBeforePx": 0,
        "spaceAfterPx": 8,
        "textAlign": "justify"
      },
      "citation": {
        "style": "Chicago",
        "locale": "en-GB",
        "note": "Use the Chicago Manual of Style notes‑and‑bibliography system to format footnotes and a reference list. Each citation should appear as a numbered note at the bottom of the page, with a corresponding entry in the bibliography."
      },
      "typography": {
        "headings": [
          {
            "name": "Title",
            "font": "Times New Roman",
            "size": "16pt",
            "weight": "700",
            "case": "title",
            "spacing": {
              "before": "12pt",
              "after": "6pt",
              "lineHeight": "1.5"
            }
          },
          {
            "name": "Heading 1",
            "font": "Times New Roman",
            "size": "14pt",
            "weight": "700",
            "case": "title",
            "spacing": {
              "before": "10pt",
              "after": "5pt",
              "lineHeight": "1.5"
            }
          },
          {
            "name": "Heading 2",
            "font": "Times New Roman",
            "size": "12pt",
            "weight": "700",
            "style": "italic",
            "case": "title",
            "spacing": {
              "before": "8pt",
              "after": "4pt",
              "lineHeight": "1.5"
            }
          },
          {
            "name": "Heading 3",
            "font": "Times New Roman",
            "size": "12pt",
            "weight": "400",
            "style": "italic",
            "case": "sentence",
            "spacing": {
              "before": "6pt",
              "after": "3pt",
              "lineHeight": "1.5"
            }
          }
        ],
        "paragraph": {
          "font": "Times New Roman",
          "size": "12pt",
          "lineHeight": "2.0",
          "alignment": "left",
          "color": "#000000",
          "spacing": {
            "before": "0pt",
            "after": "6pt"
          }
        },
        "emphasis": [
          {
            "label": "Strong",
            "style": {
              "weight": "700",
              "color": "#000000"
            }
          },
          {
            "label": "Italic",
            "style": {
              "italic": true,
              "color": "#000000"
            }
          },
          {
            "label": "Quote",
            "style": {
              "italic": true,
              "color": "#333333"
            }
          }
        ]
      },
      "colors": {
        "accent": "#156082",
        "muted": "#666666",
        "background": "#FFFFFF"
      },
      "layout": {
        "margins": "1in",
        "gutter": "0.75in",
        "grid": "single",
        "columns": 1
      },
      "houseStyle": {
        "quotes": "Use single quotation marks, reserving double quotation marks for quotations within quotations as per the Chatham House style guide【857399576858549†L277-L287】.",
        "dashes": "For parenthetical phrases use an en‑dash surrounded by spaces; do not use an em dash【857399576858549†L300-L301】.",
        "serialComma": "Omit the serial comma before ‘and’ in lists unless needed for clarity【857399576858549†L311-L313】.",
        "numbers": "Spell out numbers one to nine; use numerals for 10 and above【857399576858549†L142-L159】."
      }
    }
  },
  {
    "id": "cyber_policy_journal",
    "label": "Cyber Policy Journal",
    "description": "Research-first layout for technology governance papers.",
    "document": {
      "type": "doc",
      "attrs": {
        "citationStyleId": "chicago-note-bibliography",
        "citationLocale": "en-US"
      },
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
    },
    "metadata": {
      "documentDefaults": {
        "fontFamily": "Times New Roman",
        "fontSizePx": 12,
        "textColor": "#0f172a",
        "headingColor": "#111827",
        "lineHeight": "double",
        "spaceBeforePx": 0,
        "spaceAfterPx": 8,
        "textAlign": "justify"
      }
    }
  },
  {
    "id": "international_affairs",
    "label": "International Affairs",
    "description": "Style template for the Journal of International Affairs, drawing on submission guidelines from Columbia’s JIA and the Georgetown Journal of International Affairs. The template uses 12‑point Times New Roman, follows Chicago notes‑and‑bibliography citations, and includes a summary tagline and author bio as required for online pieces.",
    "document": {
      "type": "doc",
      "attrs": {
        "citationStyleId": "chicago-note-bibliography",
        "citationLocale": "en-US"
      },
      "content": [
        {
          "type": "heading",
          "attrs": {
            "level": 1
          },
          "content": [
            {
              "type": "text",
              "text": "Article Title"
            }
          ]
        },
        {
          "type": "paragraph",
          "content": [
            {
              "type": "text",
              "text": "Summary tagline capturing the core argument of the essay."
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
              "text": "Introduction"
            }
          ]
        },
        {
          "type": "paragraph",
          "content": [
            {
              "type": "text",
              "text": "Compose the main text using 1.5 line spacing and justified alignment. Use footnotes for citations; each note corresponds to a Chicago‑style entry in the bibliography."
            }
          ]
        },
        {
          "type": "paragraph",
          "content": [
            {
              "type": "text",
              "text": "Citations appear as superscript numbers",
              "marks": []
            },
            {
              "type": "text",
              "text": "1",
              "marks": [
                {
                  "type": "footnote"
                }
              ]
            },
            {
              "type": "text",
              "text": " with the full reference presented in an endnote or footnote following Chicago guidelines."
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
              "text": "Conclusion"
            }
          ]
        },
        {
          "type": "paragraph",
          "content": [
            {
              "type": "text",
              "text": "Summarize the key points, ensuring each paragraph remains concise and within the recommended length."
            }
          ]
        },
        {
          "type": "paragraph",
          "content": [
            {
              "type": "text",
              "text": "Author Name is a researcher in international relations at Institution Name."
            }
          ]
        }
      ]
    },
    "metadata": {
      "documentDefaults": {
        "fontFamily": "Times New Roman",
        "fontSizePx": 12,
        "textColor": "#0f172a",
        "headingColor": "#111827",
        "lineHeight": "double",
        "spaceBeforePx": 0,
        "spaceAfterPx": 8,
        "textAlign": "justify"
      },
      "citation": {
        "style": "Chicago",
        "locale": "en-US",
        "note": "Use the Chicago Manual of Style notes‑and‑bibliography system. JIA specifies that all facts and quotations must be cited using Chicago‑style citations【101171438270059†L113-L116】【101171438270059†L154-L156】, and GJIA requires endnotes adhering to Chicago’s 17th edition【942078689576472†L149-L163】."
      },
      "typography": {
        "headings": [
          {
            "name": "Title",
            "font": "Times New Roman",
            "size": "16pt",
            "weight": "700",
            "case": "title",
            "spacing": {
              "before": "12pt",
              "after": "6pt",
              "lineHeight": "1.5"
            }
          },
          {
            "name": "Heading 1",
            "font": "Times New Roman",
            "size": "14pt",
            "weight": "700",
            "case": "title",
            "spacing": {
              "before": "10pt",
              "after": "5pt",
              "lineHeight": "1.5"
            }
          },
          {
            "name": "Heading 2",
            "font": "Times New Roman",
            "size": "12pt",
            "weight": "700",
            "style": "italic",
            "case": "title",
            "spacing": {
              "before": "8pt",
              "after": "4pt",
              "lineHeight": "1.5"
            }
          },
          {
            "name": "Heading 3",
            "font": "Times New Roman",
            "size": "12pt",
            "weight": "400",
            "style": "italic",
            "case": "sentence",
            "spacing": {
              "before": "6pt",
              "after": "3pt",
              "lineHeight": "1.5"
            }
          }
        ],
        "paragraph": {
          "font": "Times New Roman",
          "size": "12pt",
          "lineHeight": "1.5",
          "alignment": "justify",
          "color": "#111111",
          "spacing": {
            "before": "0pt",
            "after": "6pt"
          }
        },
        "tagline": {
          "font": "Times New Roman",
          "size": "11pt",
          "style": "italic",
          "alignment": "center",
          "color": "#444444",
          "spacing": {
            "before": "0pt",
            "after": "8pt"
          }
        },
        "biography": {
          "font": "Times New Roman",
          "size": "10pt",
          "style": "italic",
          "alignment": "left",
          "color": "#555555",
          "spacing": {
            "before": "8pt",
            "after": "0pt"
          }
        },
        "emphasis": [
          {
            "label": "Strong",
            "style": {
              "weight": "700",
              "color": "#0b3c5d"
            }
          },
          {
            "label": "Italic",
            "style": {
              "italic": true,
              "color": "#1f2933"
            }
          }
        ]
      },
      "colors": {
        "accent": "#0b3c5d",
        "muted": "#6b7280",
        "background": "#ffffff"
      },
      "layout": {
        "margins": "1in",
        "gutter": "0.75in",
        "grid": "single",
        "columns": 1
      },
      "digitalGuidelines": {
        "paragraphLength": "Keep paragraphs under eight lines for online articles【101171438270059†L154-L157】.",
        "tagline": "Include a two‑ to three‑line summary at the start of the essay【101171438270059†L158-L160】.",
        "bio": "Add a one‑ to two‑line author bio at the end of the article【101171438270059†L158-L161】.",
        "fontSize": "For online submissions, use a 12‑point font as suggested by the Georgetown Journal guidelines【942078689576472†L178-L182】."
      }
    }
  },
  {
    "id": "journal_template_full",
    "label": "Journal Template Full",
    "description": "Comprehensive template showing most supported formatting options (headings, paragraph spacing, alignment, colors, marks, lists, tables).",
    "document": {
      "type": "doc",
      "attrs": {
        "citationStyleId": "chicago-note-bibliography",
        "citationLocale": "en-US"
      },
      "content": [
        {
          "type": "heading",
          "attrs": {
            "level": 1,
            "textAlign": "center",
            "spaceAfter": 10
          },
          "content": [
            {
              "type": "text",
              "text": "Journal Template Full"
            }
          ]
        },
        {
          "type": "paragraph",
          "attrs": {
            "lineHeight": "double",
            "spaceAfter": 8
          },
          "content": [
            {
              "type": "text",
              "text": "This template demonstrates the editor's supported formatting options. Use it as a reference for building real journal templates."
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
              "text": "Typography & Marks"
            }
          ]
        },
        {
          "type": "paragraph",
          "attrs": {
            "lineHeight": "double",
            "spaceAfter": 8
          },
          "content": [
            {
              "type": "text",
              "text": "Bold",
              "marks": [
                {
                  "type": "bold"
                }
              ]
            },
            {
              "type": "text",
              "text": ", "
            },
            {
              "type": "text",
              "text": "Italic",
              "marks": [
                {
                  "type": "italic"
                }
              ]
            },
            {
              "type": "text",
              "text": ", "
            },
            {
              "type": "text",
              "text": "Underline",
              "marks": [
                {
                  "type": "underline"
                }
              ]
            },
            {
              "type": "text",
              "text": ", "
            },
            {
              "type": "text",
              "text": "Strikethrough",
              "marks": [
                {
                  "type": "strikethrough"
                }
              ]
            },
            {
              "type": "text",
              "text": ", "
            },
            {
              "type": "text",
              "text": "Superscript",
              "marks": [
                {
                  "type": "superscript"
                }
              ]
            },
            {
              "type": "text",
              "text": ", "
            },
            {
              "type": "text",
              "text": "Subscript",
              "marks": [
                {
                  "type": "subscript"
                }
              ]
            },
            {
              "type": "text",
              "text": ", "
            },
            {
              "type": "text",
              "text": "Highlight",
              "marks": [
                {
                  "type": "highlightColor",
                  "attrs": {
                    "highlight": "#fde68a"
                  }
                }
              ]
            },
            {
              "type": "text",
              "text": ", "
            },
            {
              "type": "text",
              "text": "Color",
              "marks": [
                {
                  "type": "textColor",
                  "attrs": {
                    "color": "#1d4ed8"
                  }
                }
              ]
            },
            {
              "type": "text",
              "text": ", "
            },
            {
              "type": "text",
              "text": "Font Family",
              "marks": [
                {
                  "type": "fontFamily",
                  "attrs": {
                    "fontFamily": "Georgia"
                  }
                }
              ]
            },
            {
              "type": "text",
              "text": ", "
            },
            {
              "type": "text",
              "text": "Font Size",
              "marks": [
                {
                  "type": "fontSize",
                  "attrs": {
                    "fontSize": 16
                  }
                }
              ]
            },
            {
              "type": "text",
              "text": "."
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
              "text": "Paragraph Layout"
            }
          ]
        },
        {
          "type": "paragraph",
          "attrs": {
            "textAlign": "justify",
            "lineHeight": "double",
            "spaceBefore": 4,
            "spaceAfter": 8,
            "indentLevel": 1
          },
          "content": [
            {
              "type": "text",
              "text": "Justified text with line spacing, spacing before/after, and an indent level."
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
              "text": "Lists"
            }
          ]
        },
        {
          "type": "bulletList",
          "content": [
            {
              "type": "listItem",
              "content": [
                {
                  "type": "paragraph",
                  "content": [
                    {
                      "type": "text",
                      "text": "Bullet item one"
                    }
                  ]
                }
              ]
            },
            {
              "type": "listItem",
              "content": [
                {
                  "type": "paragraph",
                  "content": [
                    {
                      "type": "text",
                      "text": "Bullet item two"
                    }
                  ]
                }
              ]
            }
          ]
        },
        {
          "type": "orderedList",
          "content": [
            {
              "type": "listItem",
              "content": [
                {
                  "type": "paragraph",
                  "content": [
                    {
                      "type": "text",
                      "text": "Numbered item one"
                    }
                  ]
                }
              ]
            },
            {
              "type": "listItem",
              "content": [
                {
                  "type": "paragraph",
                  "content": [
                    {
                      "type": "text",
                      "text": "Numbered item two"
                    }
                  ]
                }
              ]
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
              "text": "Block Quote"
            }
          ]
        },
        {
          "type": "blockquote",
          "content": [
            {
              "type": "paragraph",
              "content": [
                {
                  "type": "text",
                  "text": "A block quote is useful for longer quotations or highlighted passages."
                }
              ]
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
              "text": "Code Block"
            }
          ]
        },
        {
          "type": "codeBlock",
          "content": [
            {
              "type": "text",
              "text": "function hello() {\\n  return 'world';\\n}"
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
              "text": "Table"
            }
          ]
        },
        {
          "type": "table",
          "content": [
            {
              "type": "tableRow",
              "content": [
                {
                  "type": "tableHeader",
                  "content": [
                    {
                      "type": "paragraph",
                      "content": [
                        {
                          "type": "text",
                          "text": "Column A"
                        }
                      ]
                    }
                  ]
                },
                {
                  "type": "tableHeader",
                  "content": [
                    {
                      "type": "paragraph",
                      "content": [
                        {
                          "type": "text",
                          "text": "Column B"
                        }
                      ]
                    }
                  ]
                }
              ]
            },
            {
              "type": "tableRow",
              "content": [
                {
                  "type": "tableCell",
                  "content": [
                    {
                      "type": "paragraph",
                      "content": [
                        {
                          "type": "text",
                          "text": "Row 1"
                        }
                      ]
                    }
                  ]
                },
                {
                  "type": "tableCell",
                  "content": [
                    {
                      "type": "paragraph",
                      "content": [
                        {
                          "type": "text",
                          "text": "Value"
                        }
                      ]
                    }
                  ]
                }
              ]
            },
            {
              "type": "tableRow",
              "content": [
                {
                  "type": "tableCell",
                  "content": [
                    {
                      "type": "paragraph",
                      "content": [
                        {
                          "type": "text",
                          "text": "Row 2"
                        }
                      ]
                    }
                  ]
                },
                {
                  "type": "tableCell",
                  "content": [
                    {
                      "type": "paragraph",
                      "content": [
                        {
                          "type": "text",
                          "text": "Value"
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    },
    "metadata": {
      "schemaVersion": 1,
      "documentDefaults": {
        "fontFamily": "Times New Roman",
        "fontSizePx": 12,
        "textColor": "#0f172a",
        "headingColor": "#111827",
        "lineHeight": "double",
        "spaceBeforePx": 0,
        "spaceAfterPx": 8,
        "textAlign": "justify"
      },
      "citation": {
        "styleId": "chicago-note-bibliography",
        "locale": "en-US"
      },
      "layout": {
        "pageSize": "A4",
        "marginsCm": {
          "top": 2.5,
          "right": 2.5,
          "bottom": 2.5,
          "left": 2.5
        }
      },
      "styles": {
        "headings": {
          "h1": {
            "fontFamily": "Times New Roman",
            "fontSizePx": 16,
            "bold": true,
            "spaceAfterPx": 10
          },
          "h2": {
            "fontFamily": "Times New Roman",
            "fontSizePx": 14,
            "bold": true,
            "spaceBeforePx": 12,
            "spaceAfterPx": 6
          },
          "h3": {
            "fontFamily": "Times New Roman",
            "fontSizePx": 12,
            "bold": true,
            "spaceBeforePx": 10,
            "spaceAfterPx": 4
          }
        },
        "paragraph": {
          "lineHeight": "double",
          "spaceAfterPx": 8
        }
      }
    }
  }
];
