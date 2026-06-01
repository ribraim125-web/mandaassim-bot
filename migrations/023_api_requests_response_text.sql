-- migrations/023_api_requests_response_text.sql
-- Adiciona o texto real gerado pelo modelo em api_requests.
-- Hoje só guardamos response_length_chars (tamanho), o que impede auditoria
-- de QUALIDADE do output. Com o texto, dá pra revisar o que o bot realmente
-- mandou e medir qualidade de verdade.

ALTER TABLE api_requests
  ADD COLUMN IF NOT EXISTS response_text TEXT;
