/* citations.js */

(function(){
  "use strict";

  function $(id){ return document.getElementById(id); }

  function _safeStr(v){
    if (v === null || v === undefined) return "";
    return String(v);
  }

  function _escapeHtml(s){
    return _safeStr(s)
      .replace(/&/g,"&amp;")
      .replace(/</g,"&lt;")
      .replace(/>/g,"&gt;")
      .replace(/"/g,"&quot;")
      .replace(/'/g,"&#39;");
  }

  function _norm(s){
    return _safeStr(s).toLowerCase().trim();
  }

  function _toIntMaybe(v){
    var n = parseInt(_safeStr(v), 10);
    return isFinite(n) ? n : null;
  }

  function _debounce(fn, ms){
    var t = null;
    return function(){
      var args = arguments;
      if (t) clearTimeout(t);
      t = setTimeout(function(){ fn.apply(null, args); }, ms);
    };
  }

  function _copyTextToClipboard(txt){
    var s = _safeStr(txt);
    if (!s) return false;

    if (navigator && navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(s);
      return true;
    }

    var ta = document.createElement("textarea");
    ta.value = s;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    ta.style.top = "-9999px";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    return true;
  }

  function _status(kind, text){
    var dot = $("statusDot");
    var el = $("statusText");
    if (el) el.textContent = _safeStr(text || "Ready");

    if (dot){
      dot.classList.remove("is-warn");
      dot.classList.remove("is-bad");
      if (kind === "warn") dot.classList.add("is-warn");
      if (kind === "bad") dot.classList.add("is-bad");
    }
  }

  function _readEmbedded(){
    var el = $("embeddedData");
    if (!el) return null;
    var raw = _safeStr(el.textContent || el.innerText || "").trim();
    if (!raw) return null;

    try{
      return JSON.parse(raw);
    }catch(_e){
      return null;
    }
  }

  function _extractReferences(payload){
    if (!payload) return [];
    if (payload.structured_references && payload.structured_references.references && Array.isArray(payload.structured_references.references)){
      return payload.structured_references.references;
    }
    if (payload.references && Array.isArray(payload.references)) return payload.references;
    return [];
  }

  function _keyOf(ref){
    var t = _safeStr(ref && ref.citation_type);
    var mid = _safeStr(ref && ref.mention_id);
    var a = _safeStr(ref && ref.citation_anchor);
    var f = _safeStr(ref && ref.footnote_number);
    var r = _safeStr(ref && ref.raw);
    return [t, mid, a, f, r].join("|");
  }

  function _prettyType(t){
    var x = _safeStr(t).toLowerCase();
    if (x === "in_text") return "In-text";
    if (x === "footnote") return "Footnote";
    return _safeStr(t);
  }

  function _anchorSortKey(ref){
    var n = _toIntMaybe(ref.citation_anchor);
    if (n !== null) return { kind: 0, n: n, s: "" };
    return { kind: 1, n: 0, s: _norm(ref.citation_anchor) };
  }

  function _footnoteSortKey(ref){
    var n = _toIntMaybe(ref.footnote_number);
    if (n !== null) return { kind: 0, n: n, s: "" };
    return { kind: 1, n: 0, s: _norm(ref.footnote_number) };
  }

  function _typeSortKey(ref){
    var x = _norm(ref.citation_type);
    if (x === "in_text") return 0;
    if (x === "footnote") return 1;
    return 2;
  }

  function _buildSearchIndex(ref){
    var parts = [];
    parts.push(_safeStr(ref.citation_anchor));
    parts.push(_safeStr(ref.footnote_number));
    parts.push(_safeStr(ref.citation_type));
    parts.push(_safeStr(ref.mention_id));
    parts.push(_safeStr(ref.raw));
    parts.push(_safeStr(ref.context_preceding));
    return _norm(parts.join(" "));
  }

  function _groupLabel(groupBy, ref){
    if (groupBy === "citation_anchor") return "Anchor " + _safeStr(ref.citation_anchor || "—");
    if (groupBy === "footnote_number") return "Footnote " + _safeStr(ref.footnote_number || "—");
    if (groupBy === "mention_id") return "Mention " + _safeStr(ref.mention_id || "—");
    return "";
  }

  function _drawSvgGraph(svg, model){
    if (!svg) return;

    while (svg.firstChild) svg.removeChild(svg.firstChild);

    var width = 1000;
    var height = 520;

    function el(name){
      return document.createElementNS("http://www.w3.org/2000/svg", name);
    }

    function setAttrs(node, attrs){
      var k;
      for (k in attrs){
        if (Object.prototype.hasOwnProperty.call(attrs, k)){
          node.setAttribute(k, _safeStr(attrs[k]));
        }
      }
    }

    var refs = model.visibleRefs;
    var groupBy = model.groupBy;

    var groupMap = {};
    var groupOrder = [];

    if (groupBy !== "none"){
      for (var i=0;i<refs.length;i++){
        var gk = _safeStr(refs[i][groupBy] || "");
        if (!Object.prototype.hasOwnProperty.call(groupMap, gk)){
          groupMap[gk] = [];
          groupOrder.push(gk);
        }
        groupMap[gk].push(refs[i]);
      }
    }

    var nodes = [];
    var edges = [];

    if (groupBy === "none"){
      for (var j=0;j<refs.length;j++){
        nodes.push({
          kind: "ref",
          ref: refs[j],
          id: _keyOf(refs[j]),
          label: _safeStr(refs[j].citation_anchor || refs[j].footnote_number || refs[j].mention_id || ("#" + (j+1))),
          sub: _prettyType(refs[j].citation_type)
        });
      }
    }else{
      for (var k=0;k<groupOrder.length;k++){
        var g = groupOrder[k];
        var gLabel = (groupBy === "citation_anchor") ? ("Anchor " + (g || "—")) :
                     (groupBy === "footnote_number") ? ("Footnote " + (g || "—")) :
                     ("Mention " + (g || "—"));

        var groupId = "group|" + groupBy + "|" + g;
        nodes.push({
          kind: "group",
          id: groupId,
          label: gLabel,
          sub: _safeStr(groupMap[g].length) + " refs"
        });

        var items = groupMap[g];
        for (var m=0;m<items.length;m++){
          var rid = _keyOf(items[m]);
          nodes.push({
            kind: "ref",
            ref: items[m],
            id: rid,
            label: _safeStr(items[m].citation_anchor || items[m].footnote_number || items[m].mention_id || ("#" + (m+1))),
            sub: _prettyType(items[m].citation_type),
            parent: groupId
          });
          edges.push({ a: groupId, b: rid, strong: true });
        }
      }
    }

    var idToIndex = {};
    for (var n=0;n<nodes.length;n++){
      idToIndex[nodes[n].id] = n;
    }

    var positions = {};
    var cx = width/2;
    var cy = height/2;

    if (groupBy === "none"){
      var r = Math.min(width, height) * 0.36;
      var count = Math.max(1, nodes.length);
      for (var p=0;p<count;p++){
        var ang = (Math.PI * 2 * p) / count;
        positions[nodes[p].id] = {
          x: cx + Math.cos(ang) * r,
          y: cy + Math.sin(ang) * r
        };
      }
    }else{
      var gc = Math.max(1, groupOrder.length);
      var gr = Math.min(width, height) * 0.28;
      for (var gi=0;gi<groupOrder.length;gi++){
        var gg = groupOrder[gi];
        var gid = "group|" + groupBy + "|" + gg;
        var gAng = (Math.PI * 2 * gi) / gc;
        var gx = cx + Math.cos(gAng) * gr;
        var gy = cy + Math.sin(gAng) * gr;
        positions[gid] = { x: gx, y: gy };

        var children = groupMap[gg];
        var childCount = Math.max(1, children.length);
        var cr = 70 + Math.min(70, childCount * 6);
        for (var ci=0;ci<children.length;ci++){
          var child = children[ci];
          var cid = _keyOf(child);
          var cAng = (Math.PI * 2 * ci) / childCount;
          positions[cid] = {
            x: gx + Math.cos(cAng) * cr,
            y: gy + Math.sin(cAng) * cr
          };
        }
      }
    }

    for (var e=0;e<edges.length;e++){
      var ed = edges[e];
      var pa = positions[ed.a];
      var pb = positions[ed.b];
      if (!pa || !pb) continue;

      var line = el("line");
      line.classList.add("edge");
      if (ed.strong) line.classList.add("is-strong");
      setAttrs(line, { x1: pa.x, y1: pa.y, x2: pb.x, y2: pb.y });
      svg.appendChild(line);
    }

    function nodeColor(node){
      if (node.kind === "group") return "rgba(255,255,255,.22)";
      var t = _norm(node.ref && node.ref.citation_type);
      if (t === "in_text") return "rgba(106,168,255,.88)";
      if (t === "footnote") return "rgba(123,240,197,.88)";
      return "rgba(255,255,255,.34)";
    }

    function radiusFor(node){
      if (node.kind === "group") return 18;
      return 12;
    }

    for (var u=0;u<nodes.length;u++){
      (function(){
        var node = nodes[u];
        var pos = positions[node.id];
        if (!pos) return;

        var g = el("g");
