import path from "path";
import { createHash } from "crypto";
import { z } from "zod";

import type { SessionData } from "../../session/sessionTypes";
import type { AnalyseRun } from "../../analyse/types";

export const manifestSchema = z.object({
  manifestVersion: z.literal(1),
  createdAt: z.string(),
  appVersion: z.string().optional(),
  platform: z.string(),
  project: z.object({
    id: z.string(),
    name: z.string()
  }),
  paths: z.object({
    sessionFile: z.string(),
    projectMetadataFile: z.string(),
    assetsDir: z.string().optional(),
    settingsFile: z.string(),
    projectStoreFile: z.string(),
    coderCacheDir: z.string().optional(),
    analyse: z
      .object({
        baseDirName: z.string().min(1),
        archivePath: z.string(),
        runs: z
          .array(
            z.object({
              id: z.string().optional(),
              label: z.string().optional(),
              relativePath: z.string()
            })
          )
          .optional(),
        activeRunRelativePath: z.string().optional()
      })
      .optional()
  }),
  checksums: z.object({
    sessionSha256: z.string()
  })
});

export type ManifestContent = z.infer<typeof manifestSchema>;

export interface AnalyseManifestInput {
  baseDir: string;
  archivePath: string;
  runs?: AnalyseRun[];
  activeRunPath?: string;
}

export interface ManifestPathsInput {
  sessionFile: string;
  projectMetadataFile: string;
  assetsDir?: string;
  settingsFile: string;
  projectStoreFile: string;
  coderCacheDir?: string;
  analyse?: AnalyseManifestInput;
}

export function computeSha256(buffer: Buffer): string {
  const hash = createHash("sha256");
  hash.update(buffer);
  return hash.digest("hex");
}

export function relativizeRunPath(baseDir: string, runPath?: string): string | undefined {
  if (!runPath) {
    return undefined;
  }
  const base = path.resolve(baseDir);
  const candidate = path.resolve(runPath);
  if (!candidate.startsWith(base)) {
    throw new Error("Run path is outside of the analyse base directory");
  }
  return path.relative(base, candidate) || ".";
}

export function absolutizeRunPath(baseDir: string, relativePath?: string): string | undefined {
  if (!relativePath) {
    return undefined;
  }
  return path.resolve(baseDir, relativePath);
}

export function createManifest(payload: {
  session: SessionData;
  appVersion?: string;
  platform: NodeJS.Platform;
  paths: ManifestPathsInput;
  sessionSha256: string;
}): ManifestContent {
  const { session, appVersion, platform, paths, sessionSha256 } = payload;
  const analyse = paths.analyse;
  const manifest: ManifestContent = {
    manifestVersion: 1,
    createdAt: new Date().toISOString(),
    appVersion,
    platform,
    project: {
      id: session.projectId,
      name: session.projectName
    },
    paths: {
      sessionFile: paths.sessionFile,
      projectMetadataFile: paths.projectMetadataFile,
      assetsDir: paths.assetsDir,
      settingsFile: paths.settingsFile,
      projectStoreFile: paths.projectStoreFile,
      coderCacheDir: paths.coderCacheDir,
      analyse: analyse
        ? {
            baseDirName: path.basename(analyse.baseDir),
            archivePath: analyse.archivePath,
            runs: analyse.runs?.map((run) => ({
              id: run.id,
              label: run.label,
              relativePath: relativizeRunPath(analyse.baseDir, run.path) ?? "."
            })),
            activeRunRelativePath: relativizeRunPath(analyse.baseDir, analyse.activeRunPath)
          }
        : undefined
    },
    checksums: {
      sessionSha256
    }
  };

  return manifestSchema.parse(manifest);
}

export function parseManifest(content: Buffer | string): ManifestContent {
  const raw = typeof content === "string" ? content : content.toString("utf-8");
  const parsed = JSON.parse(raw);
  return manifestSchema.parse(parsed);
}
