WITH clean_events AS (
  SELECT name, session_id, calendar_id, day, created_at
  FROM product_events
  WHERE is_qa = 0
),
calendar_depth AS (
  SELECT
    calendar_id,
    COUNT(DISTINCT CASE WHEN name = 'calendar_opened' THEN session_id END) AS readers,
    COUNT(DISTINCT CASE WHEN name = 'slot_reserved' THEN session_id END) AS reservers,
    COUNT(DISTINCT CASE WHEN name = 'slot_published' THEN session_id END) AS publishers,
    COUNT(DISTINCT CASE WHEN name = 'outbound_opened' THEN session_id END) AS outbound_readers
  FROM clean_events
  WHERE calendar_id IS NOT NULL
  GROUP BY calendar_id
),
calendar_continuity AS (
  SELECT
    calendar_id,
    MIN(CASE WHEN name = 'calendar_created' THEN day END) AS created_day,
    MAX(CASE WHEN name = 'calendar_updated' THEN day END) AS updated_day
  FROM clean_events
  WHERE calendar_id IS NOT NULL
  GROUP BY calendar_id
),
slot_totals AS (
  SELECT
    calendar_id,
    COUNT(*) AS reserved_slots,
    SUM(CASE WHEN article_url <> '' THEN 1 ELSE 0 END) AS published_slots
  FROM slots
  GROUP BY calendar_id
),
funnel AS (
  SELECT
    COUNT(DISTINCT CASE WHEN name = 'visited' THEN session_id END) AS visitors,
    COUNT(DISTINCT CASE WHEN name = 'calendar_created' THEN session_id END) AS creators,
    COUNT(DISTINCT CASE WHEN name = 'join_opened' THEN session_id END) AS joiners,
    COUNT(DISTINCT CASE WHEN name = 'slot_reserved' THEN session_id END) AS reservers,
    COUNT(DISTINCT CASE WHEN name = 'slot_published' THEN session_id END) AS publishers,
    COUNT(DISTINCT CASE WHEN name = 'calendar_opened' THEN session_id END) AS calendar_readers,
    COUNT(DISTINCT CASE WHEN name = 'outbound_opened' THEN session_id END) AS outbound_readers,
    COUNT(DISTINCT CASE WHEN name = 'calendar_updated' THEN session_id END) AS editors,
    COUNT(DISTINCT CASE WHEN name = 'returned' THEN session_id END) AS returned,
    COUNT(DISTINCT CASE WHEN name = 'calendar_reported' THEN session_id END) AS reporters,
    COUNT(DISTINCT CASE WHEN name = 'calendar_deleted' THEN session_id END) AS deleters
  FROM clean_events
)
SELECT
  funnel.*,
  (SELECT COUNT(*) FROM calendars WHERE status = 'active') AS active_calendars,
  (SELECT COUNT(*) FROM calendars WHERE status = 'hidden') AS hidden_calendars,
  (SELECT COUNT(*) FROM calendar_depth WHERE reservers >= 3) AS calendars_with_three_reservers,
  (SELECT COUNT(*) FROM slot_totals WHERE reserved_slots >= 5) AS calendars_with_five_slots,
  (SELECT COUNT(*) FROM slot_totals WHERE published_slots >= 3) AS calendars_with_three_published,
  (SELECT COUNT(*) FROM calendar_depth WHERE outbound_readers >= 2) AS calendars_with_two_outbound_readers,
  (
    SELECT COUNT(*)
    FROM calendar_depth d
    JOIN slot_totals s ON s.calendar_id = d.calendar_id
    WHERE d.reservers >= 5 AND s.published_slots >= 3 AND d.outbound_readers >= 2
  ) AS qualified_calendars,
  (
    SELECT COUNT(*)
    FROM calendar_continuity
    WHERE created_day IS NOT NULL
      AND updated_day IS NOT NULL
      AND updated_day > created_day
  ) AS calendars_updated_later
FROM funnel;
