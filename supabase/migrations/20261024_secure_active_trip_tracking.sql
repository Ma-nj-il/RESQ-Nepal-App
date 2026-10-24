-- RESQ Nepal — authorize active-trip GPS reads and writes.
--
-- Local migration only. Do not apply to hosted Supabase without explicit
-- owner approval. Replaces the schema.sql policies that did not restrict
-- location visibility to active trips or bind the inserted driver_id.

drop policy if exists "trip_locations_select_involved" on public.trip_locations;
create policy "trip_locations_select_active_involved" on public.trip_locations
  for select using (
    exists (
      select 1
      from public.bookings b
      where b.id = trip_locations.booking_id
        and b.status in ('assigned', 'arriving', 'arrived', 'started')
        and trip_locations.driver_id = b.driver_id
        and (
          b.user_id = auth.uid()
          or exists (
            select 1
            from public.drivers d
            where d.id = b.driver_id
              and d.user_id = auth.uid()
          )
        )
    )
  );

drop policy if exists "trip_locations_insert_driver" on public.trip_locations;
create policy "trip_locations_insert_active_assigned_driver" on public.trip_locations
  for insert with check (
    driver_id is not null
    and exists (
      select 1
      from public.bookings b
      join public.drivers d on d.id = b.driver_id
      where b.id = trip_locations.booking_id
        and b.status in ('assigned', 'arriving', 'arrived', 'started')
        and d.user_id = auth.uid()
        and trip_locations.driver_id = d.id
    )
  );

-- The base schema already creates this covering index; retain it as an
-- explicit, idempotent prerequisite for the scoped latest-location poll.
create index if not exists trip_locations_booking_idx
  on public.trip_locations(booking_id, recorded_at desc);
