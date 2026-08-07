-- ===========================================================================
-- seed.sql — GENERATED FILE, DO NOT EDIT BY HAND
--
-- Regenerate with:  npm run seed:generate
-- Source of truth:  lib/mock-data.ts
--
-- Development only. Never run against production.
--
-- NOTE: profiles.id references auth.users(id), so real auth users must exist
-- first. For local development either seed auth.users yourself, or drop the
-- foreign key while iterating:
--   alter table profiles drop constraint profiles_id_fkey;
-- ===========================================================================

-- Club: SkyRunners — Drone delivery, GPS-denied autonomy, and aircraft design.

begin;

-- Wipe in dependency order so re-seeding is idempotent
delete from update_schedules;
delete from join_requests;
delete from terms;
delete from deliverables;
delete from work_logs;
delete from project_members;
delete from projects;
delete from team_memberships;
update profiles set primary_team_id = null, lead_id = null;
delete from teams;
delete from profiles;


-- Members (lead_id set afterwards to avoid ordering problems)
insert into profiles (id, email, full_name, global_role, status, class_year, major, skills, joined_at) values ('cec91677-20a4-5de6-98e5-0e03982a0419', 'anish25@stanford.edu', 'Anish Bayya', 'co_lead', 'active', 2028, 'Aeronautics & Astronautics', array['systems', 'software'], '2026-03-18');
insert into profiles (id, email, full_name, global_role, status, class_year, major, skills, joined_at) values ('acb421eb-3cd9-5642-8d98-2901b8306020', 'praghavan@stanford.edu', 'Priya Raghavan', 'lead', 'active', 2027, 'Mechanical Engineering', array['CAD', 'composites', 'structures'], '2026-03-20');
insert into profiles (id, email, full_name, global_role, status, class_year, major, skills, joined_at) values ('81b38125-92a4-5c98-8f09-5ff1b75974d8', 'moyelaran@stanford.edu', 'Marcus Oyelaran', 'lead', 'active', 2027, 'Electrical Engineering', array['avionics', 'embedded', 'power'], '2026-03-21');
insert into profiles (id, email, full_name, global_role, status, class_year, major, skills, joined_at) values ('66e42efd-ba99-52f8-a088-8893c181a1e7', 'lfischer@stanford.edu', 'Lena Fischer', 'lead', 'active', 2027, 'Computer Science', array['SLAM', 'computer vision', 'ROS'], '2026-04-02');
insert into profiles (id, email, full_name, global_role, status, class_year, major, skills, joined_at) values ('17b5e85e-f27c-5865-9bc7-e6f66864e1c0', 'jwhitfield@stanford.edu', 'James Whitfield', 'lead', 'active', 2028, 'Product Design', array['outreach', 'rapid prototyping'], '2026-04-05');
insert into profiles (id, email, full_name, global_role, status, class_year, major, skills, joined_at) values ('2d07b15f-9bc6-5657-b68e-a7686f961725', 'devpatel@stanford.edu', 'Dev Patel', 'lead', 'active', 2028, 'Mechanical Engineering', array['layup', 'tooling'], '2026-04-11');
insert into profiles (id, email, full_name, global_role, status, class_year, major, skills, joined_at) values ('53c0b7ef-b3ac-53cb-8239-3f880a2e8b6d', 'smarquez@stanford.edu', 'Sofia Marquez', 'member', 'active', 2029, 'Mechanical Engineering', array['layup'], '2026-04-14');
insert into profiles (id, email, full_name, global_role, status, class_year, major, skills, joined_at) values ('5b2e4ad2-aa90-55fe-aee0-a3c7ffa59684', 'knakamura@stanford.edu', 'Kenji Nakamura', 'member', 'active', 2029, 'Electrical Engineering', array['PCB design', 'firmware'], '2026-04-18');
insert into profiles (id, email, full_name, global_role, status, class_year, major, skills, joined_at) values ('e0d2abbf-cb43-5248-b1dd-8617a5a0938a', 'aokonkwo@stanford.edu', 'Amara Okonkwo', 'member', 'active', 2028, 'Computer Science', array['computer vision', 'Python'], '2026-04-20');
insert into profiles (id, email, full_name, global_role, status, class_year, major, skills, joined_at) values ('323d292a-dea1-55ff-be73-69d95648b247', 'tbrooks@stanford.edu', 'Tyler Brooks', 'member', 'active', 2029, 'Aeronautics & Astronautics', array['CAD', 'FEA'], '2026-05-01');
insert into profiles (id, email, full_name, global_role, status, class_year, major, skills, joined_at) values ('59c7a175-a379-579c-beb5-c50176dce830', 'hsuzuki@stanford.edu', 'Hana Suzuki', 'member', 'active', 2028, 'Mechanical Engineering', array['propulsion', 'testing'], '2026-05-03');
insert into profiles (id, email, full_name, global_role, status, class_year, major, skills, joined_at) values ('7f43a5c8-12de-5538-99b8-fb229103cd9b', 'ohaddad@stanford.edu', 'Omar Haddad', 'member', 'active', 2029, 'Computer Science', array['ROS', 'simulation'], '2026-05-09');
insert into profiles (id, email, full_name, global_role, status, class_year, major, skills, joined_at) values ('949d3a52-47cf-5c7d-a25c-894d48f64310', 'gracelin@stanford.edu', 'Grace Lin', 'member', 'active', 2029, 'Symbolic Systems', array['outreach', 'design'], '2026-05-12');
insert into profiles (id, email, full_name, global_role, status, class_year, major, skills, joined_at) values ('b6ee3b13-568b-521d-ad04-1aefba71d60c', 'nbergstrom@stanford.edu', 'Noah Bergström', 'member', 'active', 2028, 'Materials Science', array['materials', 'testing'], '2026-06-02');

-- Divisions first (parent_id null), then nested teams
insert into teams (id, name, slug, description, parent_id, lead_id, is_active) values ('93f183dc-b8ff-5d9c-8883-bc7c3941f20b', 'Fixed Wing eVTOL', 'fixed-wing-evtol', 'Transitioning VTOL airframe for long-range delivery.', null, 'acb421eb-3cd9-5642-8d98-2901b8306020', true);
insert into teams (id, name, slug, description, parent_id, lead_id, is_active) values ('b8a69c92-ac9f-50fe-ac69-1d7f8f1e6ba7', 'SkyBeta', 'skybeta', 'Flight-test platform and avionics bring-up.', null, '81b38125-92a4-5c98-8f09-5ff1b75974d8', true);
insert into teams (id, name, slug, description, parent_id, lead_id, is_active) values ('950290a5-1edd-5f3e-8f13-9a9a6c76cc6f', 'Spade', 'spade', 'GPS-denied autonomy and onboard perception.', null, '66e42efd-ba99-52f8-a088-8893c181a1e7', true);
insert into teams (id, name, slug, description, parent_id, lead_id, is_active) values ('2f66c952-46d8-5877-ac26-4600e438df04', 'DroneHacks', 'dronehacks', 'Outreach, workshops, and rapid-prototype builds.', null, '17b5e85e-f27c-5865-9bc7-e6f66864e1c0', true);
insert into teams (id, name, slug, description, parent_id, lead_id, is_active) values ('24ce8449-c198-5b7e-aa06-c319404083a6', 'SkyDelta', 'skydelta', 'Next-generation delivery vehicle concept studies.', null, 'acb421eb-3cd9-5642-8d98-2901b8306020', true);
insert into teams (id, name, slug, description, parent_id, lead_id, is_active) values ('f32b549b-d19f-5606-b4d1-3a40e8b3819e', 'Structures', 'structures', null, '93f183dc-b8ff-5d9c-8883-bc7c3941f20b', 'acb421eb-3cd9-5642-8d98-2901b8306020', true);
insert into teams (id, name, slug, description, parent_id, lead_id, is_active) values ('6e6d0c82-dcdd-5856-9c19-d617ffc62c04', 'Composites', 'composites', null, 'f32b549b-d19f-5606-b4d1-3a40e8b3819e', '2d07b15f-9bc6-5657-b68e-a7686f961725', true);
insert into teams (id, name, slug, description, parent_id, lead_id, is_active) values ('9a152cd9-ff8a-59d6-a1c8-21b3a6a4e538', 'Propulsion', 'propulsion', null, '93f183dc-b8ff-5d9c-8883-bc7c3941f20b', '81b38125-92a4-5c98-8f09-5ff1b75974d8', true);
insert into teams (id, name, slug, description, parent_id, lead_id, is_active) values ('e933cb12-9181-5cd4-b2d3-c19f4cb386cd', 'Perception', 'perception', null, '950290a5-1edd-5f3e-8f13-9a9a6c76cc6f', '66e42efd-ba99-52f8-a088-8893c181a1e7', true);
insert into teams (id, name, slug, description, parent_id, lead_id, is_active) values ('899a77d0-d1fc-5f04-88ed-8c1c0cb5f4f9', 'Avionics', 'avionics', null, 'b8a69c92-ac9f-50fe-ac69-1d7f8f1e6ba7', '81b38125-92a4-5c98-8f09-5ff1b75974d8', true);

-- Reporting chain and home teams
update profiles set lead_id = 'cec91677-20a4-5de6-98e5-0e03982a0419', primary_team_id = 'f32b549b-d19f-5606-b4d1-3a40e8b3819e' where id = 'acb421eb-3cd9-5642-8d98-2901b8306020';
update profiles set lead_id = 'cec91677-20a4-5de6-98e5-0e03982a0419', primary_team_id = '899a77d0-d1fc-5f04-88ed-8c1c0cb5f4f9' where id = '81b38125-92a4-5c98-8f09-5ff1b75974d8';
update profiles set lead_id = 'cec91677-20a4-5de6-98e5-0e03982a0419', primary_team_id = 'e933cb12-9181-5cd4-b2d3-c19f4cb386cd' where id = '66e42efd-ba99-52f8-a088-8893c181a1e7';
update profiles set lead_id = 'cec91677-20a4-5de6-98e5-0e03982a0419' where id = '17b5e85e-f27c-5865-9bc7-e6f66864e1c0';
update profiles set lead_id = 'acb421eb-3cd9-5642-8d98-2901b8306020', primary_team_id = '6e6d0c82-dcdd-5856-9c19-d617ffc62c04' where id = '2d07b15f-9bc6-5657-b68e-a7686f961725';
update profiles set lead_id = '2d07b15f-9bc6-5657-b68e-a7686f961725', primary_team_id = '6e6d0c82-dcdd-5856-9c19-d617ffc62c04' where id = '53c0b7ef-b3ac-53cb-8239-3f880a2e8b6d';
update profiles set lead_id = '81b38125-92a4-5c98-8f09-5ff1b75974d8', primary_team_id = '899a77d0-d1fc-5f04-88ed-8c1c0cb5f4f9' where id = '5b2e4ad2-aa90-55fe-aee0-a3c7ffa59684';
update profiles set lead_id = '66e42efd-ba99-52f8-a088-8893c181a1e7', primary_team_id = 'e933cb12-9181-5cd4-b2d3-c19f4cb386cd' where id = 'e0d2abbf-cb43-5248-b1dd-8617a5a0938a';
update profiles set lead_id = 'acb421eb-3cd9-5642-8d98-2901b8306020', primary_team_id = 'f32b549b-d19f-5606-b4d1-3a40e8b3819e' where id = '323d292a-dea1-55ff-be73-69d95648b247';
update profiles set lead_id = '81b38125-92a4-5c98-8f09-5ff1b75974d8', primary_team_id = '9a152cd9-ff8a-59d6-a1c8-21b3a6a4e538' where id = '59c7a175-a379-579c-beb5-c50176dce830';
update profiles set lead_id = '66e42efd-ba99-52f8-a088-8893c181a1e7', primary_team_id = 'e933cb12-9181-5cd4-b2d3-c19f4cb386cd' where id = '7f43a5c8-12de-5538-99b8-fb229103cd9b';
update profiles set lead_id = '17b5e85e-f27c-5865-9bc7-e6f66864e1c0' where id = '949d3a52-47cf-5c7d-a25c-894d48f64310';
update profiles set lead_id = '2d07b15f-9bc6-5657-b68e-a7686f961725', primary_team_id = '6e6d0c82-dcdd-5856-9c19-d617ffc62c04' where id = 'b6ee3b13-568b-521d-ad04-1aefba71d60c';

-- Projects, parents before children
insert into projects (id, name, slug, description, parent_id, team_id, primary_re_id, phase, health, start_date, target_date, dates_overridden, is_open_to_join, open_roles, time_commitment) values ('d9d1650a-5f75-5985-aeca-ad522d27de5e', 'eVTOL Airframe v2', 'evtol-airframe-v2', 'Second-generation transitioning airframe targeting 4 kg payload at 30 km range.', null, '93f183dc-b8ff-5d9c-8883-bc7c3941f20b', 'acb421eb-3cd9-5642-8d98-2901b8306020', 'detailed_design', 'on_track', '2026-04-01', '2026-12-15', true, true, 'FEA, tooling design', '~6 hrs/week');
insert into projects (id, name, slug, description, parent_id, team_id, primary_re_id, phase, health, start_date, target_date, dates_overridden, is_open_to_join, open_roles, time_commitment) values ('d1456ca5-2a34-5666-9b6b-bda8fe6e98d1', 'Wing Spar Redesign', 'wing-spar-redesign', 'Carbon spar reducing mass 18% while holding 3.5g limit load.', 'd9d1650a-5f75-5985-aeca-ad522d27de5e', 'f32b549b-d19f-5606-b4d1-3a40e8b3819e', '323d292a-dea1-55ff-be73-69d95648b247', 'detailed_design', 'at_risk', '2026-05-01', '2026-09-30', true, true, 'FEA support', '~4 hrs/week');
insert into projects (id, name, slug, description, parent_id, team_id, primary_re_id, phase, health, start_date, target_date, dates_overridden, is_open_to_join, open_roles, time_commitment) values ('50db4512-2fce-55b7-bea5-3baac47a28c1', 'Layup Process Qualification', 'layup-process-qualification', 'Repeatable wet layup procedure with coupon testing.', 'd1456ca5-2a34-5666-9b6b-bda8fe6e98d1', '6e6d0c82-dcdd-5856-9c19-d617ffc62c04', '53c0b7ef-b3ac-53cb-8239-3f880a2e8b6d', 'manufacturing', 'on_track', '2026-06-01', '2026-08-30', true, true, null, '~3 hrs/week');
insert into projects (id, name, slug, description, parent_id, team_id, primary_re_id, phase, health, start_date, target_date, dates_overridden, is_open_to_join, open_roles, time_commitment) values ('ab67c335-292a-559b-a60a-ff7771eaaeeb', 'Spar Load Testing', 'spar-load-testing', 'Static load rig and instrumented failure testing.', 'd1456ca5-2a34-5666-9b6b-bda8fe6e98d1', 'f32b549b-d19f-5606-b4d1-3a40e8b3819e', 'b6ee3b13-568b-521d-ad04-1aefba71d60c', 'integration', 'on_track', '2026-07-15', '2026-10-15', true, true, 'instrumentation, data acquisition', '~4 hrs/week');
insert into projects (id, name, slug, description, parent_id, team_id, primary_re_id, phase, health, start_date, target_date, dates_overridden, is_open_to_join, open_roles, time_commitment) values ('13171b85-aeb0-59e1-812e-211bd03a2ef1', 'GPS-Denied Navigation', 'gps-denied-navigation', 'Visual-inertial odometry stack for indoor and urban flight.', null, '950290a5-1edd-5f3e-8f13-9a9a6c76cc6f', '66e42efd-ba99-52f8-a088-8893c181a1e7', 'testing', 'on_track', '2026-04-15', '2026-11-30', true, true, 'SLAM tuning, dataset collection', '~6 hrs/week');
insert into projects (id, name, slug, description, parent_id, team_id, primary_re_id, phase, health, start_date, target_date, dates_overridden, is_open_to_join, open_roles, time_commitment) values ('68968f93-e860-5538-b9d3-5eb3d3030d85', 'VIO Pipeline', 'vio-pipeline', 'Real-time visual-inertial odometry on companion compute.', '13171b85-aeb0-59e1-812e-211bd03a2ef1', 'e933cb12-9181-5cd4-b2d3-c19f4cb386cd', 'e0d2abbf-cb43-5248-b1dd-8617a5a0938a', 'testing', 'on_track', '2026-05-01', '2026-10-01', true, true, null, '~5 hrs/week');
insert into projects (id, name, slug, description, parent_id, team_id, primary_re_id, phase, health, start_date, target_date, dates_overridden, is_open_to_join, open_roles, time_commitment) values ('c584a753-ae75-5def-b6b4-c448be927d17', 'Simulation Environment', 'simulation-environment', 'Gazebo world and scripted scenarios for regression testing.', '13171b85-aeb0-59e1-812e-211bd03a2ef1', 'e933cb12-9181-5cd4-b2d3-c19f4cb386cd', '7f43a5c8-12de-5538-99b8-fb229103cd9b', 'manufacturing', 'blocked', '2026-06-01', '2026-09-15', true, true, 'ROS 2 migration help', '~3 hrs/week');
insert into projects (id, name, slug, description, parent_id, team_id, primary_re_id, phase, health, start_date, target_date, dates_overridden, is_open_to_join, open_roles, time_commitment) values ('9c354344-2e74-5be4-a644-3bcfd3564ef8', 'Avionics Bring-Up', 'avionics-bring-up', 'Flight controller integration, power distribution, telemetry.', null, 'b8a69c92-ac9f-50fe-ac69-1d7f8f1e6ba7', '81b38125-92a4-5c98-8f09-5ff1b75974d8', 'integration', 'on_track', '2026-04-20', '2026-10-30', true, true, 'firmware, harness fabrication', '~5 hrs/week');
insert into projects (id, name, slug, description, parent_id, team_id, primary_re_id, phase, health, start_date, target_date, dates_overridden, is_open_to_join, open_roles, time_commitment) values ('da7aed08-92b2-5d8f-8b84-ed29d4d25f07', 'Power Distribution Board', 'power-distribution-board', 'Custom PDB with current sensing and redundant BEC.', '9c354344-2e74-5be4-a644-3bcfd3564ef8', '899a77d0-d1fc-5f04-88ed-8c1c0cb5f4f9', '5b2e4ad2-aa90-55fe-aee0-a3c7ffa59684', 'detailed_design', 'on_track', '2026-06-15', '2026-09-01', true, true, null, '~4 hrs/week');
insert into projects (id, name, slug, description, parent_id, team_id, primary_re_id, phase, health, start_date, target_date, dates_overridden, is_open_to_join, open_roles, time_commitment) values ('bbf85d46-32e2-56bd-af26-50f67907792d', 'Propulsion Test Stand', 'propulsion-test-stand', 'Thrust and efficiency characterization for candidate motors.', null, '9a152cd9-ff8a-59d6-a1c8-21b3a6a4e538', '59c7a175-a379-579c-beb5-c50176dce830', 'manufacturing', 'on_track', '2026-05-20', '2026-09-20', true, true, 'load cell calibration', '~4 hrs/week');
insert into projects (id, name, slug, description, parent_id, team_id, primary_re_id, phase, health, start_date, target_date, dates_overridden, is_open_to_join, open_roles, time_commitment) values ('fdd82e35-8f1a-5838-9f7a-cab3b6fda405', 'Fall Workshop Series', 'fall-workshop-series', 'Four beginner build workshops for new members.', null, '2f66c952-46d8-5877-ac26-4600e438df04', '17b5e85e-f27c-5865-9bc7-e6f66864e1c0', 'requirements', 'on_track', '2026-08-01', '2026-11-15', true, true, 'instructors, curriculum', '~2 hrs/week');
insert into projects (id, name, slug, description, parent_id, team_id, primary_re_id, phase, health, start_date, target_date, dates_overridden, is_open_to_join, open_roles, time_commitment) values ('c3cb16ca-1275-5366-91ac-f690f1dab212', 'SkyDelta Concept Study', 'skydelta-concept-study', 'Trade study for the next-generation delivery airframe.', null, '24ce8449-c198-5b7e-aa06-c319404083a6', 'acb421eb-3cd9-5642-8d98-2901b8306020', 'concept', 'on_track', '2026-07-01', '2027-01-31', true, true, 'sizing analysis, mission modeling', '~3 hrs/week');

-- Project membership and responsibilities
insert into project_members (project_id, member_id, role, responsibility, joined_at, commitment) values ('13171b85-aeb0-59e1-812e-211bd03a2ef1', 'cec91677-20a4-5de6-98e5-0e03982a0419', 'contributor', 'Mission requirements and flight-test coordination', '2026-04-16', 'committed');
insert into project_members (project_id, member_id, role, responsibility, joined_at, commitment) values ('c3cb16ca-1275-5366-91ac-f690f1dab212', 'cec91677-20a4-5de6-98e5-0e03982a0419', 're', 'Trade study scope and sizing review', '2026-07-01', 'committed');
insert into project_members (project_id, member_id, role, responsibility, joined_at, commitment) values ('9c354344-2e74-5be4-a644-3bcfd3564ef8', 'cec91677-20a4-5de6-98e5-0e03982a0419', 'observer', null, '2026-05-06', 'following');
insert into project_members (project_id, member_id, role, responsibility, joined_at, commitment) values ('d9d1650a-5f75-5985-aeca-ad522d27de5e', 'acb421eb-3cd9-5642-8d98-2901b8306020', 're', 'Overall airframe integration', '2026-04-01', 'committed');
insert into project_members (project_id, member_id, role, responsibility, joined_at, commitment) values ('d9d1650a-5f75-5985-aeca-ad522d27de5e', '323d292a-dea1-55ff-be73-69d95648b247', 're', 'Structural analysis', '2026-05-01', 'committed');
insert into project_members (project_id, member_id, role, responsibility, joined_at, commitment) values ('d9d1650a-5f75-5985-aeca-ad522d27de5e', '53c0b7ef-b3ac-53cb-8239-3f880a2e8b6d', 'contributor', 'Composite fabrication', '2026-05-04', 'committed');
insert into project_members (project_id, member_id, role, responsibility, joined_at, commitment) values ('d1456ca5-2a34-5666-9b6b-bda8fe6e98d1', '323d292a-dea1-55ff-be73-69d95648b247', 're', 'Spar design and analysis', '2026-05-01', 'committed');
insert into project_members (project_id, member_id, role, responsibility, joined_at, commitment) values ('d1456ca5-2a34-5666-9b6b-bda8fe6e98d1', 'b6ee3b13-568b-521d-ad04-1aefba71d60c', 'contributor', 'Material characterization', '2026-06-02', 'committed');
insert into project_members (project_id, member_id, role, responsibility, joined_at, commitment) values ('50db4512-2fce-55b7-bea5-3baac47a28c1', '53c0b7ef-b3ac-53cb-8239-3f880a2e8b6d', 're', 'Process documentation', '2026-06-01', 'committed');
insert into project_members (project_id, member_id, role, responsibility, joined_at, commitment) values ('50db4512-2fce-55b7-bea5-3baac47a28c1', 'b6ee3b13-568b-521d-ad04-1aefba71d60c', 'contributor', 'Coupon testing', '2026-06-10', 'committed');
insert into project_members (project_id, member_id, role, responsibility, joined_at, commitment) values ('ab67c335-292a-559b-a60a-ff7771eaaeeb', 'b6ee3b13-568b-521d-ad04-1aefba71d60c', 're', 'Test rig and instrumentation', '2026-07-15', 'committed');
insert into project_members (project_id, member_id, role, responsibility, joined_at, commitment) values ('13171b85-aeb0-59e1-812e-211bd03a2ef1', '66e42efd-ba99-52f8-a088-8893c181a1e7', 're', 'Autonomy architecture', '2026-04-15', 'committed');
insert into project_members (project_id, member_id, role, responsibility, joined_at, commitment) values ('13171b85-aeb0-59e1-812e-211bd03a2ef1', 'e0d2abbf-cb43-5248-b1dd-8617a5a0938a', 're', 'Perception stack', '2026-04-20', 'committed');
insert into project_members (project_id, member_id, role, responsibility, joined_at, commitment) values ('68968f93-e860-5538-b9d3-5eb3d3030d85', 'e0d2abbf-cb43-5248-b1dd-8617a5a0938a', 're', 'VIO implementation', '2026-05-01', 'committed');
insert into project_members (project_id, member_id, role, responsibility, joined_at, commitment) values ('68968f93-e860-5538-b9d3-5eb3d3030d85', '7f43a5c8-12de-5538-99b8-fb229103cd9b', 'contributor', 'Dataset collection', '2026-05-20', 'committed');
insert into project_members (project_id, member_id, role, responsibility, joined_at, commitment) values ('c584a753-ae75-5def-b6b4-c448be927d17', '7f43a5c8-12de-5538-99b8-fb229103cd9b', 're', 'Simulation environment', '2026-06-01', 'committed');
insert into project_members (project_id, member_id, role, responsibility, joined_at, commitment) values ('9c354344-2e74-5be4-a644-3bcfd3564ef8', '81b38125-92a4-5c98-8f09-5ff1b75974d8', 're', 'Avionics integration', '2026-04-20', 'committed');
insert into project_members (project_id, member_id, role, responsibility, joined_at, commitment) values ('9c354344-2e74-5be4-a644-3bcfd3564ef8', '5b2e4ad2-aa90-55fe-aee0-a3c7ffa59684', 're', 'Electronics design', '2026-04-25', 'committed');
insert into project_members (project_id, member_id, role, responsibility, joined_at, commitment) values ('da7aed08-92b2-5d8f-8b84-ed29d4d25f07', '5b2e4ad2-aa90-55fe-aee0-a3c7ffa59684', 're', 'PDB schematic and layout', '2026-06-15', 'committed');
insert into project_members (project_id, member_id, role, responsibility, joined_at, commitment) values ('bbf85d46-32e2-56bd-af26-50f67907792d', '59c7a175-a379-579c-beb5-c50176dce830', 're', 'Test stand and data', '2026-05-20', 'committed');
insert into project_members (project_id, member_id, role, responsibility, joined_at, commitment) values ('fdd82e35-8f1a-5838-9f7a-cab3b6fda405', '17b5e85e-f27c-5865-9bc7-e6f66864e1c0', 're', 'Workshop program', '2026-08-01', 'committed');
insert into project_members (project_id, member_id, role, responsibility, joined_at, commitment) values ('fdd82e35-8f1a-5838-9f7a-cab3b6fda405', '949d3a52-47cf-5c7d-a25c-894d48f64310', 're', 'Curriculum and logistics', '2026-08-01', 'committed');
insert into project_members (project_id, member_id, role, responsibility, joined_at, commitment) values ('c3cb16ca-1275-5366-91ac-f690f1dab212', 'acb421eb-3cd9-5642-8d98-2901b8306020', 're', 'Trade study lead', '2026-07-01', 'committed');

-- Deliverables
insert into deliverables (project_id, title, owner_id, due_date, status, completed_at, blocker_note, sort_order) values ('d1456ca5-2a34-5666-9b6b-bda8fe6e98d1', 'Spar FEA converged at 3.5g limit load', '323d292a-dea1-55ff-be73-69d95648b247', '2026-08-15', 'in_progress', null, null, 1);
insert into deliverables (project_id, title, owner_id, due_date, status, completed_at, blocker_note, sort_order) values ('d1456ca5-2a34-5666-9b6b-bda8fe6e98d1', 'Mass reduction options memo for CDR', '323d292a-dea1-55ff-be73-69d95648b247', '2026-08-12', 'open', null, null, 2);
insert into deliverables (project_id, title, owner_id, due_date, status, completed_at, blocker_note, sort_order) values ('d1456ca5-2a34-5666-9b6b-bda8fe6e98d1', 'Material allowables from coupon data', 'b6ee3b13-568b-521d-ad04-1aefba71d60c', '2026-07-30', 'blocked', null, 'Waiting on coupon results from the layup project.', 3);
insert into deliverables (project_id, title, owner_id, due_date, status, completed_at, blocker_note, sort_order) values ('d1456ca5-2a34-5666-9b6b-bda8fe6e98d1', 'Preliminary spar geometry in CAD', '323d292a-dea1-55ff-be73-69d95648b247', null, 'done', '2026-06-20', null, 4);
insert into deliverables (project_id, title, owner_id, due_date, status, completed_at, blocker_note, sort_order) values ('50db4512-2fce-55b7-bea5-3baac47a28c1', 'Wet layup procedure written and reviewed', '53c0b7ef-b3ac-53cb-8239-3f880a2e8b6d', '2026-08-20', 'in_progress', null, null, 1);
insert into deliverables (project_id, title, owner_id, due_date, status, completed_at, blocker_note, sort_order) values ('50db4512-2fce-55b7-bea5-3baac47a28c1', 'Six coupons cured within spec', '53c0b7ef-b3ac-53cb-8239-3f880a2e8b6d', '2026-08-25', 'blocked', null, 'Vacuum pump seal is leaking.', 2);
insert into deliverables (project_id, title, owner_id, due_date, status, completed_at, blocker_note, sort_order) values ('50db4512-2fce-55b7-bea5-3baac47a28c1', 'Coupon tensile test report', 'b6ee3b13-568b-521d-ad04-1aefba71d60c', '2026-08-28', 'open', null, null, 3);
insert into deliverables (project_id, title, owner_id, due_date, status, completed_at, blocker_note, sort_order) values ('50db4512-2fce-55b7-bea5-3baac47a28c1', 'Tooling fabricated', '53c0b7ef-b3ac-53cb-8239-3f880a2e8b6d', null, 'done', '2026-07-10', null, 4);
insert into deliverables (project_id, title, owner_id, due_date, status, completed_at, blocker_note, sort_order) values ('d9d1650a-5f75-5985-aeca-ad522d27de5e', 'Mass budget updated with spar estimate', '323d292a-dea1-55ff-be73-69d95648b247', '2026-08-14', 'in_progress', null, null, 1);
insert into deliverables (project_id, title, owner_id, due_date, status, completed_at, blocker_note, sort_order) values ('d9d1650a-5f75-5985-aeca-ad522d27de5e', 'CDR package assembled', 'acb421eb-3cd9-5642-8d98-2901b8306020', '2026-08-11', 'in_progress', null, null, 2);
insert into deliverables (project_id, title, owner_id, due_date, status, completed_at, blocker_note, sort_order) values ('d9d1650a-5f75-5985-aeca-ad522d27de5e', 'Interface control document v1', 'acb421eb-3cd9-5642-8d98-2901b8306020', null, 'done', '2026-06-28', null, 3);
insert into deliverables (project_id, title, owner_id, due_date, status, completed_at, blocker_note, sort_order) values ('13171b85-aeb0-59e1-812e-211bd03a2ef1', 'Flight-test plan for outdoor VIO runs', 'cec91677-20a4-5de6-98e5-0e03982a0419', '2026-08-18', 'in_progress', null, null, 1);
insert into deliverables (project_id, title, owner_id, due_date, status, completed_at, blocker_note, sort_order) values ('13171b85-aeb0-59e1-812e-211bd03a2ef1', 'Mission requirements baselined', 'cec91677-20a4-5de6-98e5-0e03982a0419', null, 'done', '2026-07-02', null, 2);
insert into deliverables (project_id, title, owner_id, due_date, status, completed_at, blocker_note, sort_order) values ('13171b85-aeb0-59e1-812e-211bd03a2ef1', 'Autonomy architecture diagram', '66e42efd-ba99-52f8-a088-8893c181a1e7', null, 'done', '2026-06-15', null, 3);
insert into deliverables (project_id, title, owner_id, due_date, status, completed_at, blocker_note, sort_order) values ('68968f93-e860-5538-b9d3-5eb3d3030d85', 'Drift under 30cm over 50m indoors', 'e0d2abbf-cb43-5248-b1dd-8617a5a0938a', null, 'done', '2026-08-04', null, 1);
insert into deliverables (project_id, title, owner_id, due_date, status, completed_at, blocker_note, sort_order) values ('68968f93-e860-5538-b9d3-5eb3d3030d85', 'Outdoor dataset collected and labelled', '7f43a5c8-12de-5538-99b8-fb229103cd9b', '2026-08-22', 'open', null, null, 2);
insert into deliverables (project_id, title, owner_id, due_date, status, completed_at, blocker_note, sort_order) values ('c584a753-ae75-5def-b6b4-c448be927d17', 'ROS 2 migration of the Gazebo world', '7f43a5c8-12de-5538-99b8-fb229103cd9b', '2026-07-25', 'blocked', null, 'Plugin API changed; need guidance on whether to pin ROS 1.', 1);
insert into deliverables (project_id, title, owner_id, due_date, status, completed_at, blocker_note, sort_order) values ('da7aed08-92b2-5d8f-8b84-ed29d4d25f07', 'PDB schematic complete', '5b2e4ad2-aa90-55fe-aee0-a3c7ffa59684', null, 'done', '2026-07-28', null, 1);
insert into deliverables (project_id, title, owner_id, due_date, status, completed_at, blocker_note, sort_order) values ('da7aed08-92b2-5d8f-8b84-ed29d4d25f07', 'Board routing finished and reviewed', '5b2e4ad2-aa90-55fe-aee0-a3c7ffa59684', '2026-08-16', 'in_progress', null, null, 2);
insert into deliverables (project_id, title, owner_id, due_date, status, completed_at, blocker_note, sort_order) values ('bbf85d46-32e2-56bd-af26-50f67907792d', 'Test stand frame welded', '59c7a175-a379-579c-beb5-c50176dce830', null, 'done', '2026-08-05', null, 1);
insert into deliverables (project_id, title, owner_id, due_date, status, completed_at, blocker_note, sort_order) values ('bbf85d46-32e2-56bd-af26-50f67907792d', 'Load cell calibrated', '59c7a175-a379-579c-beb5-c50176dce830', '2026-08-19', 'blocked', null, 'Need calibration weights — do we own any?', 2);
insert into deliverables (project_id, title, owner_id, due_date, status, completed_at, blocker_note, sort_order) values ('c3cb16ca-1275-5366-91ac-f690f1dab212', 'Mission sizing spreadsheet v1', 'cec91677-20a4-5de6-98e5-0e03982a0419', '2026-08-29', 'in_progress', null, null, 1);
insert into deliverables (project_id, title, owner_id, due_date, status, completed_at, blocker_note, sort_order) values ('c3cb16ca-1275-5366-91ac-f690f1dab212', 'Trade study scope agreed with Co-Leads', 'cec91677-20a4-5de6-98e5-0e03982a0419', null, 'done', '2026-07-20', null, 2);
insert into deliverables (project_id, title, owner_id, due_date, status, completed_at, blocker_note, sort_order) values ('fdd82e35-8f1a-5838-9f7a-cab3b6fda405', 'Four workshop lesson plans drafted', '949d3a52-47cf-5c7d-a25c-894d48f64310', '2026-09-10', 'open', null, null, 1);
insert into deliverables (project_id, title, owner_id, due_date, status, completed_at, blocker_note, sort_order) values ('fdd82e35-8f1a-5838-9f7a-cab3b6fda405', 'Parts list and budget for workshop kits', '17b5e85e-f27c-5865-9bc7-e6f66864e1c0', '2026-09-01', 'open', null, null, 2);
insert into deliverables (project_id, title, owner_id, due_date, status, completed_at, blocker_note, sort_order) values ('ab67c335-292a-559b-a60a-ff7771eaaeeb', 'Load rig CAD complete', 'b6ee3b13-568b-521d-ad04-1aefba71d60c', '2026-08-30', 'in_progress', null, null, 1);
insert into deliverables (project_id, title, owner_id, due_date, status, completed_at, blocker_note, sort_order) values ('ab67c335-292a-559b-a60a-ff7771eaaeeb', 'Instrumentation plan', 'b6ee3b13-568b-521d-ad04-1aefba71d60c', '2026-09-15', 'open', null, null, 2);

-- Join requests
insert into join_requests (project_id, member_id, note, status, requested_at, decided_at, decided_by_id) values ('ab67c335-292a-559b-a60a-ff7771eaaeeb', '949d3a52-47cf-5c7d-a25c-894d48f64310', 'I want to learn instrumentation and data acquisition — happy to start on wiring.', 'pending', '2026-08-04', null, null);
insert into join_requests (project_id, member_id, note, status, requested_at, decided_at, decided_by_id) values ('68968f93-e860-5538-b9d3-5eb3d3030d85', '323d292a-dea1-55ff-be73-69d95648b247', 'Interested in the perception side; I''ve done some OpenCV work.', 'pending', '2026-07-28', null, null);
insert into join_requests (project_id, member_id, note, status, requested_at, decided_at, decided_by_id) values ('da7aed08-92b2-5d8f-8b84-ed29d4d25f07', '53c0b7ef-b3ac-53cb-8239-3f880a2e8b6d', 'Would like to pick up soldering and board bring-up.', 'accepted', '2026-07-01', '2026-07-02', '5b2e4ad2-aa90-55fe-aee0-a3c7ffa59684');

-- Academic terms. Obligations generate ONLY where generates_obligations is true,
-- so finals and breaks never produce missed-update rows.
insert into terms (name, kind, starts_on, ends_on, generates_obligations) values ('Summer 2026', 'summer', '2026-06-15', '2026-09-20', false);
insert into terms (name, kind, starts_on, ends_on, generates_obligations) values ('Autumn 2026', 'quarter', '2026-09-21', '2026-12-04', true);
insert into terms (name, kind, starts_on, ends_on, generates_obligations) values ('Autumn finals', 'finals', '2026-12-05', '2026-12-12', false);
insert into terms (name, kind, starts_on, ends_on, generates_obligations) values ('Winter break', 'break', '2026-12-13', '2027-01-04', false);
insert into terms (name, kind, starts_on, ends_on, generates_obligations) values ('Winter 2027', 'quarter', '2027-01-05', '2027-03-19', true);

-- Update schedules: two per week, on days each member picks
insert into update_schedules (member_id, updates_per_week, weekdays, due_time) values ('cec91677-20a4-5de6-98e5-0e03982a0419', 2, array[1, 4], '23:59');
insert into update_schedules (member_id, updates_per_week, weekdays, due_time) values ('acb421eb-3cd9-5642-8d98-2901b8306020', 2, array[1, 4], '23:59');
insert into update_schedules (member_id, updates_per_week, weekdays, due_time) values ('81b38125-92a4-5c98-8f09-5ff1b75974d8', 2, array[1, 4], '23:59');
insert into update_schedules (member_id, updates_per_week, weekdays, due_time) values ('66e42efd-ba99-52f8-a088-8893c181a1e7', 2, array[1, 4], '23:59');
insert into update_schedules (member_id, updates_per_week, weekdays, due_time) values ('17b5e85e-f27c-5865-9bc7-e6f66864e1c0', 2, array[1, 4], '23:59');
insert into update_schedules (member_id, updates_per_week, weekdays, due_time) values ('2d07b15f-9bc6-5657-b68e-a7686f961725', 2, array[1, 4], '23:59');
insert into update_schedules (member_id, updates_per_week, weekdays, due_time) values ('53c0b7ef-b3ac-53cb-8239-3f880a2e8b6d', 2, array[1, 4], '23:59');
insert into update_schedules (member_id, updates_per_week, weekdays, due_time) values ('5b2e4ad2-aa90-55fe-aee0-a3c7ffa59684', 2, array[1, 4], '23:59');
insert into update_schedules (member_id, updates_per_week, weekdays, due_time) values ('e0d2abbf-cb43-5248-b1dd-8617a5a0938a', 2, array[1, 4], '23:59');
insert into update_schedules (member_id, updates_per_week, weekdays, due_time) values ('323d292a-dea1-55ff-be73-69d95648b247', 2, array[1, 4], '23:59');
insert into update_schedules (member_id, updates_per_week, weekdays, due_time) values ('59c7a175-a379-579c-beb5-c50176dce830', 2, array[1, 4], '23:59');
insert into update_schedules (member_id, updates_per_week, weekdays, due_time) values ('7f43a5c8-12de-5538-99b8-fb229103cd9b', 2, array[1, 4], '23:59');
insert into update_schedules (member_id, updates_per_week, weekdays, due_time) values ('949d3a52-47cf-5c7d-a25c-894d48f64310', 2, array[1, 4], '23:59');
insert into update_schedules (member_id, updates_per_week, weekdays, due_time) values ('b6ee3b13-568b-521d-ad04-1aefba71d60c', 2, array[1, 4], '23:59');

-- Logged hours
insert into work_logs (member_id, project_id, work_date, hours, description) values ('cec91677-20a4-5de6-98e5-0e03982a0419', '13171b85-aeb0-59e1-812e-211bd03a2ef1', '2026-08-05', 2.5, 'Flight-test planning');
insert into work_logs (member_id, project_id, work_date, hours, description) values ('cec91677-20a4-5de6-98e5-0e03982a0419', '13171b85-aeb0-59e1-812e-211bd03a2ef1', '2026-08-03', 2, 'Requirements review');
insert into work_logs (member_id, project_id, work_date, hours, description) values ('cec91677-20a4-5de6-98e5-0e03982a0419', 'c3cb16ca-1275-5366-91ac-f690f1dab212', '2026-08-04', 3, 'Sizing spreadsheet');
insert into work_logs (member_id, project_id, work_date, hours, description) values ('53c0b7ef-b3ac-53cb-8239-3f880a2e8b6d', '50db4512-2fce-55b7-bea5-3baac47a28c1', '2026-08-05', 3, 'Coupon layup');
insert into work_logs (member_id, project_id, work_date, hours, description) values ('53c0b7ef-b3ac-53cb-8239-3f880a2e8b6d', '50db4512-2fce-55b7-bea5-3baac47a28c1', '2026-08-04', 3.5, 'Tooling prep');
insert into work_logs (member_id, project_id, work_date, hours, description) values ('323d292a-dea1-55ff-be73-69d95648b247', 'd1456ca5-2a34-5666-9b6b-bda8fe6e98d1', '2026-08-05', 4, 'FEA runs');
insert into work_logs (member_id, project_id, work_date, hours, description) values ('323d292a-dea1-55ff-be73-69d95648b247', 'd1456ca5-2a34-5666-9b6b-bda8fe6e98d1', '2026-08-03', 5, 'Mesh refinement');
insert into work_logs (member_id, project_id, work_date, hours, description) values ('e0d2abbf-cb43-5248-b1dd-8617a5a0938a', '68968f93-e860-5538-b9d3-5eb3d3030d85', '2026-08-05', 4.5, 'Drift tuning');
insert into work_logs (member_id, project_id, work_date, hours, description) values ('e0d2abbf-cb43-5248-b1dd-8617a5a0938a', '68968f93-e860-5538-b9d3-5eb3d3030d85', '2026-08-02', 4, 'Indoor test runs');
insert into work_logs (member_id, project_id, work_date, hours, description) values ('5b2e4ad2-aa90-55fe-aee0-a3c7ffa59684', 'da7aed08-92b2-5d8f-8b84-ed29d4d25f07', '2026-08-04', 7, 'PCB routing');
insert into work_logs (member_id, project_id, work_date, hours, description) values ('59c7a175-a379-579c-beb5-c50176dce830', 'bbf85d46-32e2-56bd-af26-50f67907792d', '2026-08-05', 5.5, 'Frame welding');
insert into work_logs (member_id, project_id, work_date, hours, description) values ('b6ee3b13-568b-521d-ad04-1aefba71d60c', 'ab67c335-292a-559b-a60a-ff7771eaaeeb', '2026-08-03', 4, 'Rig CAD');
insert into work_logs (member_id, project_id, work_date, hours, description) values ('7f43a5c8-12de-5538-99b8-fb229103cd9b', 'c584a753-ae75-5def-b6b4-c448be927d17', '2026-08-01', 1.5, 'ROS 2 migration attempt');

commit;

-- Sanity checks
-- select count(*) from profiles;        -- expect 14
-- select count(*) from teams;           -- expect 10
-- select count(*) from projects;        -- expect 12
-- select count(*) from project_members; -- expect 23
-- Every project should resolve to a division:
-- select p.name from projects p
--   left join v_project_division d on d.project_id = p.id
--   where d.division_id is null;

