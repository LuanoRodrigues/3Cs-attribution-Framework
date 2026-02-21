function normalizeName(value) {
  return String(value || "").trim().toLowerCase();
}

function cleanIdentifier(value) {
  return String(value || "")
    .trim()
    .replace(/^[`"'“”‘’]+|[`"'“”‘’]+$/g, "")
    .replace(/[.!,;:)\]]+$/g, "")
    .trim();
}

function parseAgentCommand(text) {
  const raw = String(text || "").trim();
  if (!raw) {
    return { ok: false, message: "Command text is required." };
  }

  const normalized = raw.replace(/\s+/g, " ").trim();
  if (/^help\b/i.test(normalized)) {
    return { ok: true, action: "help", args: {} };
  }

  const createPattern = /(create|make)\s+(a\s+)?(subfolder|subcollection)\b/i;
  if (!createPattern.test(normalized)) {
    return {
      ok: false,
      message:
        "Unsupported command. Try: create subfolder inside folder <collection> getting only items with <tag> tag"
    };
  }

  const parentMatch =
    normalized.match(
      /(?:inside|under|in)\s+(?:folder|collection)\s+["“]?([^,"”]+?)["”]?(?=(?:,|\s+(?:with|having|get(?:ting)?|for)\b|$))/i
    ) ||
    normalized.match(
      /(?:inside|under|in)\s+["“]?([^,"”]+?)["”]?(?=(?:,|\s+(?:with|having|get(?:ting)?|for)\b|$))/i
    );
  const parentIdentifier = cleanIdentifier(parentMatch?.[1] || "");

  const tagMatches = [...normalized.matchAll(/["“]?([a-zA-Z0-9 _-]+?)["”]?\s+tag\b/gi)];
  const tag = cleanIdentifier(tagMatches.length ? tagMatches[tagMatches.length - 1][1] : "");

  const subfolderMatch = normalized.match(
    /(?:subfolder|subcollection)\s+["“]?([^,"”]+?)["”]?\s+(?:inside|under|in)\b/i
  );
  const parsedSubfolder = cleanIdentifier(subfolderMatch?.[1] || "");
  const subfolderName = parsedSubfolder || tag;

  if (!parentIdentifier) {
    return { ok: false, message: "Could not parse target folder/collection from command." };
  }
  if (!tag) {
    return { ok: false, message: "Could not parse tag from command." };
  }
  if (!subfolderName) {
    return { ok: false, message: "Could not determine subfolder name." };
  }

  return {
    ok: true,
    action: "create_subfolder_by_tag",
    args: {
      parentIdentifier,
      tag,
      subfolderName
    }
  };
}

function buildCollectionIndexes(collections) {
  const byKey = new Map();
  const byName = new Map();
  const byPath = new Map();
  const byParent = new Map();
  const pathCache = new Map();

  collections.forEach((collection) => {
    byKey.set(collection.key, collection);
    const parentKey = collection.parentKey || null;
    if (!byParent.has(parentKey)) byParent.set(parentKey, []);
    byParent.get(parentKey).push(collection);
  });

  const fullPath = (collectionKey) => {
    if (pathCache.has(collectionKey)) return pathCache.get(collectionKey);
    const collection = byKey.get(collectionKey);
    if (!collection) return "";
    const own = collection.name || collection.key;
    if (!collection.parentKey || !byKey.has(collection.parentKey)) {
      pathCache.set(collectionKey, own);
      return own;
    }
    const path = `${fullPath(collection.parentKey)}/${own}`;
    pathCache.set(collectionKey, path);
    return path;
  };

  collections.forEach((collection) => {
    const normName = normalizeName(collection.name);
    const normPath = normalizeName(fullPath(collection.key));
    if (!byName.has(normName)) byName.set(normName, []);
    byName.get(normName).push(collection);
    byPath.set(normPath, collection);
    collection.fullPath = fullPath(collection.key);
  });

  return { byKey, byName, byPath, byParent };
}

function resolveCollectionIdentifier(identifier, indexes) {
  const raw = cleanIdentifier(identifier);
  const normalized = normalizeName(raw);
  if (!normalized) return { ok: false, message: "Empty collection identifier." };

  if (indexes.byKey.has(raw)) {
    return { ok: true, collection: indexes.byKey.get(raw) };
  }
  if (indexes.byPath.has(normalized)) {
    return { ok: true, collection: indexes.byPath.get(normalized) };
  }

  const byName = indexes.byName.get(normalized) || [];
  if (byName.length === 1) {
    return { ok: true, collection: byName[0] };
  }
  if (byName.length > 1) {
    return {
      ok: false,
      message: `Collection name '${identifier}' is ambiguous. Use full path.`,
      choices: byName.map((collection) => `${collection.fullPath} [${collection.key}]`)
    };
  }

  return { ok: false, message: `Collection not found: ${identifier}` };
}

async function executeCreateSubfolderByTag(ops, args, options = {}) {
  const dryRun = options.dryRun === true;
  const collections = await ops.fetchAllCollections();
  const indexes = buildCollectionIndexes(collections);

  const parentResolved = resolveCollectionIdentifier(args.parentIdentifier, indexes);
  if (!parentResolved.ok) {
    return {
      status: "error",
      message: parentResolved.message,
      choices: parentResolved.choices || []
    };
  }
  const parent = parentResolved.collection;

  const subfolderName = cleanIdentifier(args.subfolderName);
  const tagNeedle = normalizeName(args.tag);

  const children = indexes.byParent.get(parent.key) || [];
  let subcollection =
    children.find((collection) => normalizeName(collection.name) === normalizeName(subfolderName)) || null;

  if (!subcollection && !dryRun) {
    const created = await ops.createSubcollection(parent.key, subfolderName);
    if (created?.key) {
      subcollection = {
        key: created.key,
        name: subfolderName,
        parentKey: parent.key,
        fullPath: `${parent.fullPath}/${subfolderName}`
      };
    } else {
      const refreshed = await ops.fetchAllCollections();
      const refreshedIndexes = buildCollectionIndexes(refreshed);
      const refreshedChildren = refreshedIndexes.byParent.get(parent.key) || [];
      subcollection =
        refreshedChildren.find((collection) => normalizeName(collection.name) === normalizeName(subfolderName)) || null;
    }
  }

  const topItems = await ops.fetchCollectionTopItems(parent.key);
  const matched = topItems.filter((item) => {
    const tags = Array.isArray(item?.data?.tags) ? item.data.tags : [];
    return tags.some((tagObj) => normalizeName(tagObj?.tag) === tagNeedle);
  });

  let added = 0;
  let skippedExisting = 0;
  const failed = [];
  if (!dryRun && subcollection) {
    for (const item of matched) {
      const existingCollections = Array.isArray(item?.data?.collections) ? item.data.collections : [];
      if (existingCollections.includes(subcollection.key)) {
        skippedExisting += 1;
        continue;
      }
      try {
        await ops.addItemToCollection(subcollection.key, item);
        added += 1;
      } catch (error) {
        failed.push({
          key: item?.key || "",
          title: item?.data?.title || "(untitled)",
          message: error.message
        });
      }
    }
  }

  return {
    status: "ok",
    dryRun,
    parent: {
      key: parent.key,
      name: parent.name,
      path: parent.fullPath || parent.name
    },
    subcollection: subcollection
      ? { key: subcollection.key, name: subcollection.name, path: subcollection.fullPath || subcollection.name }
      : { key: "", name: subfolderName, path: `${parent.fullPath || parent.name}/${subfolderName}` },
    tag: args.tag,
    scannedItems: topItems.length,
    matchedItems: matched.length,
    addedItems: added,
    skippedExisting,
    failed,
    sampleMatches: matched.slice(0, 10).map((item) => ({
      key: item?.key || "",
      title: item?.data?.title || "(untitled)"
    }))
  };
}

function createZoteroAgentRegistry(ops) {
  const helpExamples = [
    "create subfolder inside folder frameworks, getting only items with framework tag",
    "create subfolder framework inside folder cyber/raw with framework tag"
  ];

  const actionHandlers = {
    create_subfolder_by_tag: (args, options = {}) =>
      executeCreateSubfolderByTag(ops, args, options)
  };

  return {
    parse: parseAgentCommand,
    listCapabilities: () => Object.keys(actionHandlers),
    help: () => helpExamples.slice(),
    async run(payload = {}) {
      const text = String(payload?.text || "").trim();
      const dryRun = payload?.dryRun === true;
      const parsed = parseAgentCommand(text);
      if (!parsed.ok) {
        return { status: "error", message: parsed.message };
      }
      if (parsed.action === "help") {
        return { status: "ok", action: "help", help: helpExamples.slice() };
      }

      const handler = actionHandlers[parsed.action];
      if (!handler) {
        return { status: "error", message: `Unsupported action: ${parsed.action}` };
      }
      const result = await handler(parsed.args, { dryRun });
      if (result?.status !== "ok") return result;
      return {
        status: "ok",
        action: parsed.action,
        parsedArgs: parsed.args,
        result
      };
    }
  };
}

module.exports = {
  createZoteroAgentRegistry
};
