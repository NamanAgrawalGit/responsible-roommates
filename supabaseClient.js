/*
Name: Naman Agrawal
This file sets up the single Supabase client used by every page to talk to
the database and handle authentication.

Note: the anon key below is safe to have in frontend code / committed to
GitHub. It is a public key by design — real security comes from the Row
Level Security policies in schema.sql, not from hiding this key. The only
Supabase key that must ever stay secret is the "service_role" key, which
this app does not use.
*/

const SUPABASE_URL = "https://hlcnkyddsbrimzhvpwtv.supabase.co";
const SUPABASE_ANON_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhsY25reWRkc2JyaW16aHZwd3R2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAwOTU3MzQsImV4cCI6MjEwNTY3MTczNH0.v2UoHcQqc1iYesfelE6l_mBilmwSTwmbItO74aM0bX8";

// "supabase" here is the global created by the CDN script tag
// (https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2) that must be
// loaded on the page BEFORE this file.
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
