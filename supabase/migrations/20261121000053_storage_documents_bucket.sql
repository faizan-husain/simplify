-- Create storage schema if not exists (for Postgres environments)
CREATE SCHEMA IF NOT EXISTS storage;

-- Create storage.buckets table if not exists
CREATE TABLE IF NOT EXISTS storage.buckets (
  id text PRIMARY KEY,
  name text NOT NULL,
  owner uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  public boolean DEFAULT false,
  avif_autodetection boolean DEFAULT false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

-- Create storage.objects table if not exists
CREATE TABLE IF NOT EXISTS storage.objects (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  bucket_id text REFERENCES storage.buckets(id),
  name text,
  owner uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  last_accessed_at timestamptz DEFAULT now(),
  metadata jsonb,
  path_tokens text[] GENERATED ALWAYS AS (string_to_array(name, '/')) STORED
);

-- Ensure documents bucket exists and is PRIVATE
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('documents', 'documents', false, 15728640, ARRAY['application/pdf']::text[])
ON CONFLICT (id) DO UPDATE SET 
  public = false,
  allowed_mime_types = ARRAY['application/pdf']::text[];

-- Enable RLS on storage.objects
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- Helper function to extract foldername if storage.foldername is not pre-installed
CREATE OR REPLACE FUNCTION storage.foldername(name text)
RETURNS text[]
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN string_to_array(name, '/');
END;
$$;

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
