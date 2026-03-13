-- Add screenshot_url column to incidents table
ALTER TABLE incidents 
ADD COLUMN IF NOT EXISTS screenshot_url TEXT;

-- Add comment for documentation
COMMENT ON COLUMN incidents.screenshot_url IS 'URL to screenshot stored in Supabase Storage, captured for high/medium severity incidents';

