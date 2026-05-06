import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export type ProfileMode = "readonly" | "readwrite";

export type Profile = {
  token_env: string;
  mode: ProfileMode;
  root_page_id?: string;
};

export type ProfileConfig = {
  default?: string;
  profiles: Record<string, Profile>;
};

export type ResolvedProfile =
  | {
      kind: "profile";
      name: string;
      profile: Profile;
      token: string;
      tokenEnv: string;
      rootPageId?: string;
    }
  | {
      kind: "env";
      name: "NOTION_TOKEN";
      profile: { mode: "readwrite"; token_env: "NOTION_TOKEN" };
      token: string;
      tokenEnv: "NOTION_TOKEN";
      rootPageId?: string;
    };

export class CliError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly exitCode = 1,
  ) {
    super(message);
  }
}

const EMPTY_CONFIG: ProfileConfig = { profiles: {} };

export function getConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.EASY_NOTION_CONFIG_DIR) {
    return env.EASY_NOTION_CONFIG_DIR;
  }
  return join(homedir(), ".config", "easy-notion-mcp");
}

export function getConfigPath(configDir: string): string {
  return join(configDir, "profiles.json");
}

export function sanitizeProfile(profile: Profile, env: NodeJS.ProcessEnv = process.env) {
  return {
    token_env: profile.token_env,
    token_present: env[profile.token_env] !== undefined && env[profile.token_env] !== "",
    mode: profile.mode,
    ...(profile.root_page_id ? { root_page_id: profile.root_page_id } : {}),
  };
}

export function configExists(configDir: string): boolean {
  return existsSync(getConfigPath(configDir));
}

export async function loadProfileConfig(configDir: string): Promise<ProfileConfig> {
  const path = getConfigPath(configDir);
  if (!existsSync(path)) {
    return { ...EMPTY_CONFIG, profiles: {} };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new CliError(
      "profile_config_invalid",
      `Could not parse profile config at ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!parsed || typeof parsed !== "object") {
    throw new CliError("profile_config_invalid", "Profile config must be a JSON object.");
  }

  const config = parsed as Partial<ProfileConfig>;
  if (config.default !== undefined && typeof config.default !== "string") {
    throw new CliError("profile_config_invalid", "`default` must be a string when present.");
  }
  if (!config.profiles || typeof config.profiles !== "object" || Array.isArray(config.profiles)) {
    throw new CliError("profile_config_invalid", "`profiles` must be an object.");
  }

  const profiles: Record<string, Profile> = {};
  for (const [name, profile] of Object.entries(config.profiles)) {
    if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
      throw new CliError("profile_config_invalid", `Profile '${name}' must be an object.`);
    }
    const candidate = profile as Partial<Profile>;
    if (typeof candidate.token_env !== "string" || candidate.token_env.trim() === "") {
      throw new CliError("profile_config_invalid", `Profile '${name}' requires token_env.`);
    }
    if (candidate.mode !== "readonly" && candidate.mode !== "readwrite") {
      throw new CliError("profile_config_invalid", `Profile '${name}' mode must be readonly or readwrite.`);
    }
    if (candidate.root_page_id !== undefined && typeof candidate.root_page_id !== "string") {
      throw new CliError("profile_config_invalid", `Profile '${name}' root_page_id must be a string.`);
    }
    profiles[name] = {
      token_env: candidate.token_env,
      mode: candidate.mode,
      ...(candidate.root_page_id ? { root_page_id: candidate.root_page_id } : {}),
    };
  }

  if (config.default && profiles[config.default] === undefined) {
    throw new CliError("profile_config_invalid", `Default profile '${config.default}' does not exist.`);
  }

  return {
    ...(config.default ? { default: config.default } : {}),
    profiles,
  };
}

export async function saveProfileConfig(configDir: string, config: ProfileConfig): Promise<void> {
  await mkdir(configDir, { recursive: true });
  await writeFile(getConfigPath(configDir), `${JSON.stringify(config, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

export function assertValidProfileName(name: string): void {
  if (!/^[A-Za-z0-9._-]+$/.test(name)) {
    throw new CliError("invalid_profile_name", "Profile names may contain only letters, numbers, dots, underscores, and hyphens.");
  }
}

export function assertValidTokenEnv(name: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new CliError("invalid_token_env", "token_env must be a valid environment variable name.");
  }
}

export function resolveProfileFromConfig(
  config: ProfileConfig,
  options: {
    requestedProfile?: string;
    env?: NodeJS.ProcessEnv;
    configFileExists: boolean;
    notionRootPageId?: string;
  },
): ResolvedProfile {
  const env = options.env ?? process.env;
  const selectedName =
    options.requestedProfile ??
    env.EASY_NOTION_PROFILE ??
    config.default;

  if (selectedName) {
    const profile = config.profiles[selectedName];
    if (!profile) {
      throw new CliError("profile_not_found", `Profile '${selectedName}' does not exist.`);
    }
    const token = env[profile.token_env];
    if (!token) {
      throw new CliError("profile_token_missing", `Environment variable ${profile.token_env} is not set for profile '${selectedName}'.`);
    }
    return {
      kind: "profile",
      name: selectedName,
      profile,
      token,
      tokenEnv: profile.token_env,
      rootPageId: profile.root_page_id,
    };
  }

  if (!options.configFileExists) {
    const token = env.NOTION_TOKEN;
    if (!token) {
      throw new CliError("notion_token_missing", "NOTION_TOKEN is required when no profile config exists.");
    }
    return {
      kind: "env",
      name: "NOTION_TOKEN",
      profile: { mode: "readwrite", token_env: "NOTION_TOKEN" },
      token,
      tokenEnv: "NOTION_TOKEN",
      rootPageId: options.notionRootPageId,
    };
  }

  throw new CliError("profile_required", "No profile selected. Pass --profile, set EASY_NOTION_PROFILE, or set a default profile.");
}
