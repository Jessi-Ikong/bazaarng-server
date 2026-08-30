const { createClient } = require('@supabase/supabase-js');

// Server-side client using the SECRET service_role key — bypasses RLS
// entirely, which is fine here because every write is already gated by
// our own authorization checks in chatController before it ever reaches
// this client. This key must never be exposed to the frontend.
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

module.exports = supabase;
