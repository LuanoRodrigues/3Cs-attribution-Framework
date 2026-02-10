import { mmToTwips, normalizeTwips, ptToTwips, RectTwips, TWIPS_PER_INCH, twipsToPx } from "../units.ts";
import type { PageSetup } from "../types.ts";
import type { LayoutRect } from "../types.ts";

export type PageFrameRects = {
  headerRect: RectTwips;
  bodyRect: RectTwips;
  footnotesRect: RectTwips;
  footerRect: RectTwips;
};

const orientationSize = (setup: PageSetup): { widthTwips: number; heightTwips: number } => {
  const width = setup.orientation === "landscape" ? setup.size.height : setup.size.width;
  const height = setup.orientation === "landscape" ? setup.size.width : setup.size.height;
  const unit = setup.size.unit ?? setup.unit;
  const toTwips = unit === "mm" ? mmToTwips : unit === "pt" ? ptToTwips : unit === "px" ? (v: number) => (v / 96) * TWIPS_PER_INCH : (v: number) => v;
  return { widthTwips: normalizeTwips(toTwips(width)), heightTwips: normalizeTwips(toTwips(height)) };
};

const marginToTwips = (setup: PageSetup, value: number): number => {
  const unit = setup.margins.unit ?? setup.unit;
  if (unit === "mm") return normalizeTwips(mmToTwips(value));
  if (unit === "pt") return normalizeTwips(ptToTwips(value));
  if (unit === "px") return normalizeTwips((value / 96) * TWIPS_PER_INCH);
  return normalizeTwips(value);
};

export const computeFrames = (setup: PageSetup): PageFrameRects => {
  const { widthTwips, heightTwips } = orientationSize(setup);
  const top = marginToTwips(setup, setup.margins.top);
  const bottom = marginToTwips(setup, setup.margins.bottom);
  const left = marginToTwips(setup, setup.margins.left);
  const right = marginToTwips(setup, setup.margins.right);
  const headerDist = marginToTwips(setup, setup.headerDistance);
  const footerDist = marginToTwips(setup, setup.footerDistance);

  const headerRect: RectTwips = {
    x: left,
    y: top,
    w: widthTwips - left - right,
    h: headerDist
  };

  const footerRect: RectTwips = {
    x: left,
    y: heightTwips - bottom - footerDist,
    w: widthTwips - left - right,
    h: footerDist
  };

  const footnotesRect: RectTwips = {
    x: left,
    y: footerRect.y - footerDist,
    w: widthTwips - left - right,
    h: footerDist
  };

  const bodyRect: RectTwips = {
    x: left,
    y: headerRect.y + headerRect.h,
    w: widthTwips - left - right,
    h: footnotesRect.y - (headerRect.y + headerRect.h)
  };

  return { headerRect, bodyRect, footnotesRect, footerRect };
};

const rectTwipsToPx = (rect: RectTwips, dpi = 96): LayoutRect => ({
  x: twipsToPx(rect.x, dpi),
  y: twipsToPx(rect.y, dpi),
  w: twipsToPx(rect.w, dpi),
  h: twipsToPx(rect.h, dpi)
});

export const computeFramesPx = (setup: PageSetup, dpi = 96): {
  headerRect: LayoutRect;
  bodyRect: LayoutRect;
  footnotesRect: LayoutRect;
  footerRect: LayoutRect;
} => {
  const frames = computeFrames(setup);
  return {
    headerRect: rectTwipsToPx(frames.headerRect, dpi),
    bodyRect: rectTwipsToPx(frames.bodyRect, dpi),
    footnotesRect: rectTwipsToPx(frames.footnotesRect, dpi),
    footerRect: rectTwipsToPx(frames.footerRect, dpi)
  };
};
