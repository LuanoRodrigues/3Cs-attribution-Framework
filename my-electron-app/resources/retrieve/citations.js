const root = document.getElementById("citation-list");
let currentContexts = [];

const renderContexts = () => {
  if (!root) {
    return;
  }
  root.innerHTML = "";
  currentContexts.forEach((context) => {
    const card = document.createElement("div");
    card.className = "citation-card";
    card.dataset.nodeId = String(context.nodeId);

    const meta = document.createElement("div");
    meta.className = "citation-meta";
    const anchor = document.createElement("span");
    anchor.textContent = context.citation_anchor;
    const page = document.createElement("span");
    page.textContent = context.page_index ? `Page ${context.page_index}` : "";
    meta.append(anchor, page);

    const contextText = document.createElement("p");
    contextText.textContent = context.context;

    const typeLabel = document.createElement("p");
    typeLabel.style.opacity = "0.7";
    typeLabel.style.fontSize = "12px";
    typeLabel.textContent = `${context.citation_type} context`;

    card.append(meta, contextText, typeLabel);
    root.appendChild(card);
  });
};

const highlightNode = (nodeId) => {
  if (!root) {
    return;
  }
  root.querySelectorAll(".citation-card").forEach((card) => {
    const target = card.dataset.nodeId;
    card.classList.toggle("active", target === nodeId);
  });
};

window.addEventListener("message", (event) => {
  const data = event.data;
  if (data?.type === "citations" && data.payload) {
    currentContexts = Array.isArray(data.payload.contexts) ? data.payload.contexts : [];
    renderContexts();
    highlightNode("active");
  }
  if (data?.type === "nodeSelect") {
    highlightNode(data.nodeId);
  }
});

// Provide fallback text when no contexts available.
if (root && !root.children.length) {
  root.textContent = "Awaiting citation data...";
}
