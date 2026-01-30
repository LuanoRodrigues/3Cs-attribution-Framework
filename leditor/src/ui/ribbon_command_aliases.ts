type CommandSpec = { id: string; args?: Record<string, unknown> };

export const COMMAND_ALIASES: Record<string, string> = {
  // Clipboard / paste
  "paste.default": "Paste",
  "paste.keepSource": "Paste",
  "paste.mergeFormatting": "Paste",
  "paste.keepTextOnly": "PastePlain",
  "paste.textOnly": "PastePlain",
  "paste.special.openDialog": "PasteClean",
  "paste.plainText": "PastePlain",
  "paste.fromWordCleanup": "PasteClean",
  "paste.autoClean.toggle": "PasteClean",
  "paste.cleanupRules.openDialog": "PasteClean",
  "paste.defaults.openDialog": "Paste",
  "clipboard.cut": "Cut",
  "clipboard.copy": "Copy",
  "clipboard.formatPainter.toggle": "RemoveFontStyle",
  "clipboard.options.openDialog": "ClipboardOptionsDialog",
  "history.undo": "Undo",
  "history.redo": "Redo",
  // Font
  "font.bold.toggle": "Bold",
  "font.italic.toggle": "Italic",
  "font.underline.toggle": "Underline",
  "font.underline.set": "Underline",
  "font.strikethrough.toggle": "Strikethrough",
  "font.subscript.toggle": "Subscript",
  "font.superscript.toggle": "Superscript",
  "font.inlineCode.toggle": "ClearFormatting",
  "font.options.openDialog": "FontOptionsDialog",
  "font.effects.openMenu": "FontEffectsMenu",
  "font.effects.openDialog": "FontEffectsDialog",
  "font.effects.outline.toggle": "FontEffectsOutline",
  "font.effects.shadow.toggle": "FontEffectsShadow",
  "font.underlineColor.openPicker": "UnderlineColorPicker",
  "font.family.set": "FontFamily",
  "font.size.set": "FontSize",
  "font.size.increase": "FontSize",
  "font.size.decrease": "FontSize",
  "font.color.applyCurrent": "TextColor",
  "font.color.set": "TextColor",
  "font.highlight.applyCurrent": "HighlightColor",
  "font.highlight.set": "HighlightColor",
  "font.clearFormatting": "ClearFormatting",
  "font.case.set": "ChangeCase",
  // Paragraph
  "list.bullet.toggle": "BulletList",
  "list.bullet.setStyle": "BulletList",
  "list.ordered.toggle": "NumberList",
  "list.ordered.setStyle": "NumberList",
  "list.multilevel.apply": "Indent",
  "list.multilevel.openMenu": "Indent",
  "list.task.toggle": "BulletList",
  "paragraph.outdent": "Outdent",
  "paragraph.indent": "Indent",
  "paragraph.sort.openDialog": "Preview",
  "view.formattingMarks.toggle": "VisualBlocks",
  "paragraph.align.set": "JustifyFull",
  "paragraph.lineSpacing.set": "LineSpacing",
  "paragraph.spaceBefore.add": "SpaceBefore",
  "paragraph.spaceBefore.remove": "SpaceBefore",
  "paragraph.spaceAfter.add": "SpaceAfter",
  "paragraph.spaceAfter.remove": "SpaceAfter",
  "paragraph.options.openDialog": "ParagraphOptionsDialog",
  "paragraph.spacing.openDialog": "ParagraphSpacingDialog",
  "paragraph.spacing.openMenu": "ParagraphSpacingMenu",
  "paragraph.borders.openDialog": "ParagraphBordersDialog",
  "paragraph.borders.openMenu": "ParagraphBordersMenu",
  "paragraph.borders.set": "ParagraphBordersSet",
  "paragraph.shading.set": "HighlightColor",
  "paragraph.blockquote.toggle": "BlockquoteToggle",
  "insert.horizontalRule": "InsertPageBreak",
  // Editing
  "editing.find.open": "SearchReplace",
  "editing.find.advanced.openDialog": "SearchReplace",
  "editing.goto.openDialog": "SearchReplace",
  "editing.find.regex.toggle": "SearchReplace",
  "editing.find.matchCase.toggle": "SearchReplace",
  "editing.find.wholeWords.toggle": "SearchReplace",
  "editing.replace.open": "SearchReplace",
  "selection.selectAll": "SelectAll",
  "selection.selectObjects": "SelectObjects",
  "selection.selectSimilarFormatting": "SelectSimilarFormatting",
  "selection.openMenu": "SelectAll",
  // View
  "view.source.openHtmlRaw": "SourceView",
  "view.source.openHtml": "SourceView",
  "view.source.openMarkdown": "SourceView",
  "view.source.openJson": "SourceView",
  "view.cleanHtml": "PasteClean",
  "view.allowedElements.open": "AllowedElements",
  // Insert — pages / breaks
  "insert.pageBreak": "InsertPageBreak",
  "InsertPageBreak": "InsertPageBreak",
  "insert.blankPage": "InsertPageBreak",
  "insert.columnBreak": "InsertColumnBreak",
  "insert.sectionBreak.nextPage": "InsertSectionBreakNextPage",
  "insert.sectionBreak.continuous": "InsertSectionBreakContinuous",
  "insert.sectionBreak.evenPage": "InsertSectionBreakEven",
  "insert.sectionBreak.oddPage": "InsertSectionBreakOdd",
  // Insert — cover/pages
  "insert.coverPage.default": "InsertTemplate",
  "insert.coverPage.apply": "InsertTemplate",
  "insert.coverPage.remove": "InsertTemplate",
  // Insert — tables
  "insert.table.apply": "InsertTable",
  "insert.table.openDialog": "InsertTable",
  "insert.table.drawMode.toggle": "InsertTable",
  "insert.table.convertText.openDialog": "InsertTable",
  "insert.table.excelEmbed": "InsertTable",
  "insert.table.quickTables.openGallery": "InsertTable",
  "insert.table.responsiveDefault.toggle": "InsertTable",
  "table.accessibility.openDialog": "InsertTable",
  // Insert — illustrations
  "insert.image.upload.openPicker": "InsertImage",
  "insert.image.stock.open": "InsertImage",
  "insert.image.online.open": "InsertImage",
  "insert.image.url.openDialog": "InsertImage",
  "insert.shape.openGallery": "InsertTemplate",
  "insert.shape.apply": "InsertTemplate",
  "insert.icon.openPicker": "InsertTemplate",
  "insert.smartArt.openPicker": "InsertTemplate",
  "insert.chart.openPicker": "InsertTemplate",
  "insert.chart.apply": "InsertTemplate",
  "insert.screenshot.open": "InsertImage",
  // Insert — links
  "link.insert.openDialog": "InsertLink",
  "link.edit.openDialog": "EditLink",
  "link.remove": "RemoveLink",
  "link.copy": "CopyLink",
  "link.open": "OpenLink",
  "link.auto.toggle": "AutoLink",
  // Insert — header/footer
  "insert.header.edit": "EditHeader",
  "insert.footer.edit": "EditFooter",
  "insert.headerFooter.exit": "ExitHeaderFooterEdit",
  // Insert — text
  "insert.textBox.drawMode.toggle": "InsertTemplate",
  "insert.quickParts.openMenu": "InsertTemplate",
  "insert.quickParts.autoText.open": "InsertTemplate",
  "insert.quickParts.documentProperty.open": "InsertTemplate",
  "insert.quickParts.saveSelection.openDialog": "InsertTemplate",
  "insert.wordArt.openGallery": "InsertTemplate",
  "insert.wordArt.apply": "InsertTemplate",
  "insert.dropCap.openMenu": "InsertTemplate",
  "insert.dropCap.apply": "InsertTemplate",
  "insert.dropCap.openDialog": "InsertTemplate",
  "insert.signatureLine.openDialog": "InsertTemplate",
  "insert.dateTime.openDialog": "InsertTemplate",
  "insert.object.openMenu": "InsertTemplate",
  "insert.object.openDialog": "InsertTemplate",
  "insert.placeholder.openMenu": "InsertTemplate",
  "insert.placeholder.openDialog": "InsertTemplate",
  "placeholders.manage.openDialog": "InsertTemplate",
  "insert.shortcode.openDialog": "InsertTemplate",
  "insert.text.openMenu": "InsertTemplate",
  "insert.textFromFile.openPicker": "InsertTemplate",
  // TOC + references
  "toc.tableOfContents": "InsertTOC",
  "toc.insert.default": "InsertTOC",
  "toc.insert.template": "InsertTOC",
  "toc.insert.custom.openDialog": "InsertTOC",
  "toc.remove": "RemoveTOC",
  "toc.addText": "InsertTocHeading",
  "toc.addText.openMenu": "InsertTocHeading",
  "toc.addText.setLevel": "InsertTocHeading",
  "toc.update": "UpdateTOC",
  "toc.update.default": "UpdateTOC",
  "toc.updateTable": "UpdateTOC",
  // Insert — symbols
  "insert.equation.openEditor": "InsertTemplate",
  "insert.equation.apply": "InsertTemplate",
  "insert.symbol.openPicker": "InsertTemplate",
  "insert.symbol.apply": "InsertTemplate",
  "insert.emoji.openPicker": "InsertTemplate"
};

export const resolveRibbonCommandId = (
  command: CommandSpec,
  args?: Record<string, unknown>
): string => {
  const merged = { ...(command.args ?? {}), ...(args ?? {}) };
  if (command.id === "paragraph.align.set") {
    switch (merged.mode) {
      case "left":
        return "AlignLeft";
      case "center":
        return "AlignCenter";
      case "right":
        return "AlignRight";
      case "justify":
        return "JustifyFull";
      default:
        return "JustifyFull";
    }
  }
  if (command.id === "font.case.set") {
    return "ChangeCase";
  }
  if (command.id === "paragraph.lineSpacing.set") {
    return "LineSpacing";
  }
  return COMMAND_ALIASES[command.id] ?? command.id;
};
