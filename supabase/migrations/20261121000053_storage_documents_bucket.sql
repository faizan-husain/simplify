-- Ensure documents bucket exists in Supabase Storage and is PRIVATE
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('documents', 'documents', false, 15728640, ARRAY['application/pdf']::text[])
ON CONFLICT (id) DO UPDATE SET 
  public = false,
  allowed_mime_types = ARRAY['application/pdf']::text[];

-- RLS: Authenticated business members can upload documents to their own business directory {business_id}/*
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Business members can upload documents'
  ) THEN
    CREATE POLICY "Business members can upload documents" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (
      bucket_id = 'documents' 
      AND (storage.foldername(name))[1] = (SELECT app.current_business_id()::text)
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Business members can view their documents'
  ) THEN
    CREATE POLICY "Business members can view their documents" ON storage.objects
    FOR SELECT TO authenticated
    USING (
      bucket_id = 'documents' 
      AND (storage.foldername(name))[1] = (SELECT app.current_business_id()::text)
    );
  END IF;
END $$;
