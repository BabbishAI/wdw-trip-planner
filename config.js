// Supabase project for saving/sharing itineraries.
// The anon/public key is meant to ship in client code — access is limited by the
// table's row-level-security policies (insert/update only; reads go through the
// get_plan(id) function, so no one can list every plan).
window.SUPABASE = {
  url: "https://jvrfdngbtbgfkgwhsenp.supabase.co/rest/v1",
  anon: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp2cmZkbmdidGJnZmtnd2hzZW5wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUwOTk5OTksImV4cCI6MjEwMDY3NTk5OX0.e7a5_V0j-ho0FRR4E6-5DF5boBflGJfNrPaaaWuAABY",
};
