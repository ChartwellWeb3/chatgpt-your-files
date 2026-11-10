-- Optional test data. Run in the PERFORMANCE project's SQL Editor.
-- Creates 12 QA drafts, including French and branded questions.
-- Approve questions in the app before choosing Run once.
-- This script does not call OpenAI or start monitoring.
-- Deterministic IDs make repeat execution preserve existing seed rows,
-- including any edits, approvals, or archiving already performed in the app.
begin;

with settings as (
  select 'qa'::text as environment
), examples (n, topic, market, language, kind, question) as (
  values
    (1, 'memory-care', 'toronto', 'en', 'unbranded',
      'My mother has dementia. Which memory-care residences in Toronto should our family consider?'),
    (2, 'independent-living', 'ottawa', 'en', 'unbranded',
      'Which independent-living retirement residences in Ottawa offer an active social life and flexible services?'),
    (3, 'assisted-living', 'calgary', 'en', 'unbranded',
      'My father needs help with daily activities. Which assisted-living residences in Calgary should we compare?'),
    (4, 'pricing', 'ontario', 'en', 'unbranded',
      'What does retirement living cost in Ontario, and which residence operators explain their pricing clearly?'),
    (5, 'location', 'mississauga', 'en', 'unbranded',
      'Which retirement residences in Mississauga are worth considering for someone who wants to stay close to shops and healthcare?'),
    (6, 'amenities', 'vancouver', 'en', 'unbranded',
      'Which retirement residences in Vancouver offer fitness programs, social activities, and transportation services?'),
    (7, 'food', 'toronto', 'en', 'unbranded',
      'Which retirement residences in Toronto should we consider if dining quality and dietary accommodations are priorities?'),
    (8, 'safety', 'ontario', 'en', 'unbranded',
      'Which retirement residence operators in Ontario provide clear information about emergency response and resident safety?'),
    (9, 'reviews', 'british-columbia', 'fr', 'unbranded',
      'Quelles résidences pour retraités en Colombie-Britannique devrais-je comparer en tenant compte des avis des résidents et des familles ?'),
    (10, 'comparison', 'canada', 'fr', 'unbranded',
      'Comment comparer les principaux groupes de résidences pour retraités au Canada, leurs services et leurs options de soins ?'),
    (11, 'comparison', 'toronto', 'en', 'branded',
      'How does Chartwell compare with other retirement residence operators in Toronto?'),
    (12, 'pricing', 'canada', 'fr', 'branded',
      'Quels services sont inclus dans le prix des résidences Chartwell au Canada ?')
)
insert into public.geo_questions (
  id, environment, question, language, question_kind,
  topic_id, market_id, status, discovery_source, discovery_notes, source_reference
)
select
  md5('geo-test-20261027-v1:' || s.environment || ':' || e.n::text)::uuid,
  s.environment, e.question, e.language, e.kind,
  t.id, m.id, 'draft', 'manual',
  'SQL test question. Review and approve before collecting an answer.',
  'sql-test-20261027-v1'
from examples e
cross join settings s
join public.geo_topics t on t.slug = e.topic
join public.geo_markets m on m.slug = e.market
on conflict (id) do nothing
returning question, language, question_kind, status;

commit;
