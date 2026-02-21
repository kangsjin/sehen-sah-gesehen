interface CliConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
}

async function loadFromRemote(): Promise<CliConfig> {
  const remoteUrl = String(process.env.APP_CONFIG_URL || 'https://sehen-sah-gesehen.vercel.app/api/config').trim();
  const res = await fetch(remoteUrl, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`Failed to load remote config (${res.status})`);
  }

  const cfg = (await res.json()) as Partial<CliConfig>;
  const supabaseUrl = String(cfg.supabaseUrl || '').trim();
  const supabaseAnonKey = String(cfg.supabaseAnonKey || '').trim();
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Remote config is missing supabaseUrl/supabaseAnonKey');
  }

  return { supabaseUrl, supabaseAnonKey };
}

export async function resolveSupabaseConfig(): Promise<CliConfig> {
  const envUrl = String(process.env.SUPABASE_URL || '').trim();
  const envKey = String(process.env.SUPABASE_ANON_KEY || '').trim();
  if (envUrl && envKey) {
    return { supabaseUrl: envUrl, supabaseAnonKey: envKey };
  }
  return loadFromRemote();
}
