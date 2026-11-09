-- SYNTHETIC LOCAL DEMO DATA ONLY. No person or registration is verified here.
-- Run against the local verification database, never a deployed database:
-- docker exec -i verification-postgres psql -v ON_ERROR_STOP=1 -U verification -d verification < tools/seed_demo_ids.sql
-- Re-running preserves existing demo decisions; it does not reset their status.
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('herbimmortal-local-demo-ids-v1'));

DO $$
DECLARE
    demo record;
    practitioner_id uuid;
    registry_id uuid;
    case_id uuid;
    fixture_reason constant text := 'SYNTHETIC LOCAL DEMO ONLY. No identity, council registration, face match, or liveness was verified.';
BEGIN
    IF current_database() <> 'verification' THEN
        RAISE EXCEPTION 'Demo seed expects the local verification database.';
    END IF;

    FOR demo IN
        SELECT * FROM (VALUES
            ('HI-26INA-DEMO1', 'DEMOLOCAL001', 'DEMO AyurvedaDemo', 'MH', 'A', 'Ayurveda', 'APPROVED', 'ACTIVE', 1),
            ('HI-26INU-DEMO2', 'DEMOLOCAL002', 'DEMO UnaniDemo', 'KA', 'U', 'Unani', 'APPROVED', 'ACTIVE', 2),
            ('HI-26INS-DEMO3', 'DEMOLOCAL003', 'DEMO SiddhaDemo', 'TN', 'S', 'Siddha', 'APPROVED', 'ACTIVE', 3),
            ('HI-26INA-DEMO4', 'DEMOLOCAL004', 'DEMO ExpiredDemo', 'MH', 'A', 'Ayurveda', 'EXPIRED', 'EXPIRED', 4),
            ('HI-26INA-DEMO5', 'DEMOLOCAL005', 'DEMO RevokedDemo', 'MH', 'A', 'Ayurveda', 'REVOKED', 'REVOKED', 5)
        ) AS fixtures(immortal_id, license, full_name, council, medical_system, specialty,
                      case_status, registry_status, row_number)
    LOOP
        practitioner_id := md5('herbimmortal-local-demo-v1:practitioner:' || demo.immortal_id)::uuid;
        registry_id := md5('herbimmortal-local-demo-v1:registry:' || demo.immortal_id)::uuid;
        case_id := md5('herbimmortal-local-demo-v1:case:' || demo.immortal_id)::uuid;

        -- Refuse collisions; never overwrite an existing practitioner.
        IF EXISTS (
            SELECT 1 FROM practitioners p
             WHERE (p.immortal_id = demo.immortal_id
                    OR (p.council_code = demo.council AND p.license_no_normalized = demo.license)
                    OR p.id = practitioner_id)
               AND (p.id <> practitioner_id OR p.immortal_id IS DISTINCT FROM demo.immortal_id
                    OR p.license_no_normalized <> demo.license OR p.council_code <> demo.council
                    OR p.full_name_raw <> demo.full_name)
        ) THEN
            RAISE EXCEPTION 'Existing data conflicts with demo ID %; nothing was changed.', demo.immortal_id;
        END IF;

        INSERT INTO registry_records (
            id, license_no_raw, full_name_raw, council_raw, status_raw, specialty_raw,
            license_no_normalized, full_name_normalized, council_code, status,
            valid_until, source_batch, source_row_number, raw_payload, content_hash
        ) VALUES (
            registry_id, demo.license, demo.full_name, 'SYNTHETIC DEMO COUNCIL RECORD',
            demo.registry_status, demo.specialty, demo.license, upper(demo.full_name),
            demo.council, demo.registry_status,
            CASE WHEN demo.case_status = 'EXPIRED' THEN current_date - 1 ELSE DATE '2030-12-31' END,
            'DEMO-LOCAL-ONLY-v1', demo.row_number,
            jsonb_build_object('syntheticDemo', true, 'notice', fixture_reason),
            encode(digest('herbimmortal-local-demo-v1:' || demo.immortal_id, 'sha256'), 'hex')
        ) ON CONFLICT (id) DO NOTHING;

        INSERT INTO practitioners (
            id, council_code, license_no_normalized, full_name_raw, immortal_id,
            country_code, medical_system_code, immortal_id_issued_at
        ) VALUES (
            practitioner_id, demo.council, demo.license, demo.full_name, demo.immortal_id,
            'IN', demo.medical_system, TIMESTAMPTZ '2026-11-09 00:00:00+00'
        ) ON CONFLICT (id) DO NOTHING;

        INSERT INTO verification_cases (
            id, practitioner_id, status, claimed_full_name, claimed_registration_number,
            claimed_council, claimed_specialty, claimed_country, claimed_medical_system,
            matched_registry_record_id, candidate_count, registry_snapshot,
            decided_at, decided_by, decision_reason
        ) VALUES (
            case_id, practitioner_id, demo.case_status, demo.full_name, demo.license,
            demo.council, demo.specialty, 'IN', demo.medical_system, registry_id, 1,
            jsonb_build_object('syntheticDemo', true, 'notice', fixture_reason,
                              'source_batch', 'DEMO-LOCAL-ONLY-v1'),
            now(), 'synthetic-local-demo-seed', fixture_reason
        ) ON CONFLICT (id) DO NOTHING;

        INSERT INTO case_rule_results (case_id, rule_code, outcome, detail)
        VALUES (case_id, 'SYNTHETIC_DEMO_FIXTURE', 'SKIPPED', fixture_reason)
        ON CONFLICT ON CONSTRAINT uq_case_rule DO NOTHING;

        INSERT INTO audit_events (
            event_type, subject_type, subject_id, actor_type, actor_id,
            to_status, reason, metadata
        )
        SELECT 'DEMO_FIXTURE_CREATED', 'verification_case', case_id, 'SYSTEM',
               'synthetic-local-demo-seed', demo.case_status, fixture_reason,
               jsonb_build_object('syntheticDemo', true, 'immortalId', demo.immortal_id)
        WHERE NOT EXISTS (
            SELECT 1 FROM audit_events a
             WHERE a.subject_id = case_id AND a.event_type = 'DEMO_FIXTURE_CREATED'
        );
    END LOOP;
END $$;

COMMIT;

SELECT p.immortal_id, p.full_name_raw, v.status AS demo_case_status
  FROM practitioners p JOIN verification_cases v ON v.practitioner_id = p.id
 WHERE v.decided_by = 'synthetic-local-demo-seed'
 ORDER BY p.immortal_id;
