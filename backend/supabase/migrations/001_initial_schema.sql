-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Profiles table (extends auth.users)
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('kid', 'parent')),
  display_name TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Parent-Kid Links table
CREATE TABLE IF NOT EXISTS parent_kid_links (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  parent_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  kid_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'revoked')),
  verification_token TEXT,
  linked_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(parent_id, kid_id)
);

-- Incidents table (synced from Electron app)
CREATE TABLE IF NOT EXISTS incidents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  kid_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  snippet TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('high', 'medium', 'low')),
  score FLOAT,
  scorer TEXT,
  lang TEXT,
  lang_score FLOAT,
  rationale TEXT,
  timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Settings table (per kid, managed by parent)
CREATE TABLE IF NOT EXISTS settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  kid_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  parent_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  alert_threshold TEXT NOT NULL DEFAULT 'medium' CHECK (alert_threshold IN ('high', 'medium', 'low')),
  auto_sync BOOLEAN NOT NULL DEFAULT true,
  notification_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(kid_id, parent_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_incidents_kid_id ON incidents(kid_id);
CREATE INDEX IF NOT EXISTS idx_incidents_timestamp ON incidents(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_severity ON incidents(severity);
CREATE INDEX IF NOT EXISTS idx_parent_kid_links_parent ON parent_kid_links(parent_id);
CREATE INDEX IF NOT EXISTS idx_parent_kid_links_kid ON parent_kid_links(kid_id);
CREATE INDEX IF NOT EXISTS idx_parent_kid_links_status ON parent_kid_links(status);

-- Function to automatically create profile on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, role)
  VALUES (NEW.id, NEW.email, 'kid') -- Default to 'kid', can be updated
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to create profile on signup
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Row Level Security (RLS) Policies

-- Enable RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE parent_kid_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

-- Profiles: Users can read/update their own profile
CREATE POLICY "users_own_profile" ON profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "users_update_own_profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);

-- Profiles: Parents can read kid profiles (for linking)
CREATE POLICY "parents_read_kid_profiles" ON profiles
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND role = 'parent'
    )
    AND role = 'kid'
  );

-- Parent-Kid Links: Parents can manage their links, kids can see if they're linked
CREATE POLICY "parents_manage_links" ON parent_kid_links
  FOR ALL USING (auth.uid() = parent_id);

CREATE POLICY "kids_see_their_links" ON parent_kid_links
  FOR SELECT USING (auth.uid() = kid_id);

-- Incidents: Kids can insert their own incidents
CREATE POLICY "kids_insert_own_incidents" ON incidents
  FOR INSERT WITH CHECK (auth.uid() = kid_id);

-- Incidents: Kids can read their own incidents
CREATE POLICY "kids_read_own_incidents" ON incidents
  FOR SELECT USING (auth.uid() = kid_id);

-- Incidents: Parents can read linked kids' incidents
CREATE POLICY "parents_read_linked_kids_incidents" ON incidents
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM parent_kid_links
      WHERE parent_id = auth.uid()
      AND kid_id = incidents.kid_id
      AND status = 'active'
    )
  );

-- Settings: Parents can manage settings for linked kids
CREATE POLICY "parents_manage_settings" ON settings
  FOR ALL USING (auth.uid() = parent_id);

-- Settings: Kids can read their own settings
CREATE POLICY "kids_read_own_settings" ON settings
  FOR SELECT USING (auth.uid() = kid_id);

