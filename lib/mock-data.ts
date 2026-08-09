/**
 * Mock data so the UI can be built and reviewed before Supabase exists.
 *
 * Everything here is fake but shaped exactly like the real schema
 * (docs/DATA_MODEL.md). When the database is wired up, these exports get
 * replaced by queries and the components shouldn't need to change.
 */

import {
  JOIN_REQUEST_STALE_DAYS,
  RE_SILENT_DAYS,
  UPDATES_PER_WEEK_DEFAULT,
  type CatalogueItem,
  type CatalogueItemKind,
  type ClubEvent,
  type JoinRequest,
  type Deliverable,
  type TrainingSection,
  type Member,
  type Project,
  type ProjectAttentionFlag,
  type ProjectArtifact,
  type ProjectMembership,
  type ProgressUpdate,
  type Team,
  type Term,
  type UpdateSchedule,
  type WorkLog,
} from "./types.ts";
import type { ContributionInputs } from "./contribution.ts";
import { readStore } from "./store/disk.ts";
import { isLiveMode } from "./env.ts";

// ---------------------------------------------------------------------------
// Club
// ---------------------------------------------------------------------------

export const club = {
  name: "SkyRunners",
  description: "Drone delivery, GPS-denied autonomy, and aircraft design.",
  createdAt: "2026-03-18",
  cycle: "2026-27",
};

// ---------------------------------------------------------------------------
// Divisions — Co-Lead configurable, add/remove at will
// ---------------------------------------------------------------------------

export const teams: Team[] = [
  {
    id: "div-evtol",
    name: "Fixed Wing eVTOL",
    slug: "fixed-wing-evtol",
    description: "Transitioning VTOL airframe for long-range delivery.",
    parentId: null,
    leadId: "m-priya",
    isActive: true,
  },
  {
    id: "div-skybeta",
    name: "SkyBeta",
    slug: "skybeta",
    description: "Flight-test platform and avionics bring-up.",
    parentId: null,
    leadId: "m-marcus",
    isActive: true,
  },
  {
    id: "div-spade",
    name: "Spade",
    slug: "spade",
    description: "GPS-denied autonomy and onboard perception.",
    parentId: null,
    leadId: "m-lena",
    isActive: true,
  },
  {
    id: "div-dronehacks",
    name: "DroneHacks",
    slug: "dronehacks",
    description: "Outreach, workshops, and rapid-prototype builds.",
    parentId: null,
    leadId: "m-james",
    isActive: true,
  },
  {
    id: "div-skydelta",
    name: "SkyDelta",
    slug: "skydelta",
    description: "Next-generation delivery vehicle concept studies.",
    parentId: null,
    leadId: "m-priya",
    isActive: true,
  },

  // Sub-teams, set up by division REs
  {
    id: "team-structures",
    name: "Structures",
    slug: "structures",
    parentId: "div-evtol",
    leadId: "m-priya",
    isActive: true,
  },
  {
    id: "team-composites",
    name: "Composites",
    slug: "composites",
    parentId: "team-structures",
    leadId: "m-dev",
    isActive: true,
  },
  {
    id: "team-propulsion",
    name: "Propulsion",
    slug: "propulsion",
    parentId: "div-evtol",
    leadId: "m-marcus",
    isActive: true,
  },
  {
    id: "team-perception",
    name: "Perception",
    slug: "perception",
    parentId: "div-spade",
    leadId: "m-lena",
    isActive: true,
  },
  {
    id: "team-avionics",
    name: "Avionics",
    slug: "avionics",
    parentId: "div-skybeta",
    leadId: "m-marcus",
    isActive: true,
  },
];

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

export const members: Member[] = [
  {
    id: "m-anish",
    fullName: "Anish Bayya",
    email: "anish25@stanford.edu",
    phone: "(650) 555-1007",
    globalRole: "co_lead",
    status: "active",
    leadId: null,
    classYear: 2028,
    major: "Aeronautics & Astronautics",
    joinedAt: "2026-03-18",
    skills: ["systems", "software"],
  },
  {
    id: "m-priya",
    fullName: "Priya Raghavan",
    email: "praghavan@stanford.edu",
    phone: "(650) 555-1014",
    globalRole: "lead",
    status: "active",
    leadId: "m-anish",
    primaryTeamId: "team-structures",
    classYear: 2027,
    major: "Mechanical Engineering",
    joinedAt: "2026-03-20",
    skills: ["CAD", "composites", "structures"],
  },
  {
    id: "m-marcus",
    fullName: "Marcus Oyelaran",
    email: "moyelaran@stanford.edu",
    phone: "(650) 555-1021",
    globalRole: "lead",
    status: "active",
    leadId: "m-anish",
    primaryTeamId: "team-avionics",
    classYear: 2027,
    major: "Electrical Engineering",
    joinedAt: "2026-03-21",
    skills: ["avionics", "embedded", "power"],
  },
  {
    id: "m-lena",
    fullName: "Lena Fischer",
    email: "lfischer@stanford.edu",
    phone: "(650) 555-1028",
    globalRole: "lead",
    status: "active",
    leadId: "m-anish",
    primaryTeamId: "team-perception",
    classYear: 2027,
    major: "Computer Science",
    joinedAt: "2026-04-02",
    skills: ["SLAM", "computer vision", "ROS"],
  },
  {
    id: "m-james",
    fullName: "James Whitfield",
    email: "jwhitfield@stanford.edu",
    phone: "(650) 555-1035",
    globalRole: "lead",
    status: "active",
    leadId: "m-anish",
    classYear: 2028,
    major: "Product Design",
    joinedAt: "2026-04-05",
    skills: ["outreach", "rapid prototyping"],
  },
  {
    id: "m-dev",
    fullName: "Dev Patel",
    email: "devpatel@stanford.edu",
    phone: "(650) 555-1042",
    globalRole: "lead",
    status: "active",
    leadId: "m-priya",
    primaryTeamId: "team-composites",
    classYear: 2028,
    major: "Mechanical Engineering",
    joinedAt: "2026-04-11",
    skills: ["layup", "tooling"],
  },
  {
    id: "m-sofia",
    fullName: "Sofia Marquez",
    email: "smarquez@stanford.edu",
    phone: "(650) 555-1049",
    globalRole: "member",
    status: "active",
    leadId: "m-dev",
    primaryTeamId: "team-composites",
    classYear: 2029,
    major: "Mechanical Engineering",
    joinedAt: "2026-04-14",
    skills: ["layup"],
  },
  {
    id: "m-kenji",
    fullName: "Kenji Nakamura",
    email: "knakamura@stanford.edu",
    phone: "(650) 555-1056",
    globalRole: "member",
    status: "active",
    leadId: "m-marcus",
    primaryTeamId: "team-avionics",
    classYear: 2029,
    major: "Electrical Engineering",
    joinedAt: "2026-04-18",
    skills: ["PCB design", "firmware"],
  },
  {
    id: "m-amara",
    fullName: "Amara Okonkwo",
    email: "aokonkwo@stanford.edu",
    phone: "(650) 555-1063",
    globalRole: "member",
    status: "active",
    leadId: "m-lena",
    primaryTeamId: "team-perception",
    classYear: 2028,
    major: "Computer Science",
    joinedAt: "2026-04-20",
    skills: ["computer vision", "Python"],
  },
  {
    id: "m-tyler",
    fullName: "Tyler Brooks",
    email: "tbrooks@stanford.edu",
    phone: "(650) 555-1070",
    globalRole: "member",
    status: "active",
    leadId: "m-priya",
    primaryTeamId: "team-structures",
    classYear: 2029,
    major: "Aeronautics & Astronautics",
    joinedAt: "2026-05-01",
    skills: ["CAD", "FEA"],
  },
  {
    id: "m-hana",
    fullName: "Hana Suzuki",
    email: "hsuzuki@stanford.edu",
    phone: "(650) 555-1077",
    globalRole: "member",
    status: "active",
    leadId: "m-marcus",
    primaryTeamId: "team-propulsion",
    classYear: 2028,
    major: "Mechanical Engineering",
    joinedAt: "2026-05-03",
    skills: ["propulsion", "testing"],
  },
  {
    id: "m-omar",
    fullName: "Omar Haddad",
    email: "ohaddad@stanford.edu",
    phone: "(650) 555-1084",
    globalRole: "member",
    status: "active",
    leadId: "m-lena",
    primaryTeamId: "team-perception",
    classYear: 2029,
    major: "Computer Science",
    joinedAt: "2026-05-09",
    skills: ["ROS", "simulation"],
  },
  {
    id: "m-grace",
    fullName: "Grace Lin",
    email: "gracelin@stanford.edu",
    globalRole: "member",
    status: "active",
    leadId: "m-james",
    classYear: 2029,
    major: "Symbolic Systems",
    joinedAt: "2026-05-12",
    skills: ["outreach", "design"],
  },
  {
    id: "m-noah",
    fullName: "Noah Bergström",
    email: "nbergstrom@stanford.edu",
    phone: "(650) 555-1098",
    globalRole: "member",
    status: "active",
    leadId: "m-dev",
    primaryTeamId: "team-composites",
    classYear: 2028,
    major: "Materials Science",
    joinedAt: "2026-06-02",
    skills: ["materials", "testing"],
  },

  // -------------------------------------------------------------------------
  // The rest of the club.
  //
  // Brings the roster to a realistic ~34. Worth having, because several things
  // only misbehave at scale: a Lead with one report makes any review queue look
  // manageable, and a five-person roster hides the fact that /find-work's
  // ordering is the whole point of the page.
  //
  // Deliberately included:
  //   - m-rosa, a second-level Lead under Marcus, so the reporting chain is four
  //     deep in two different branches rather than one.
  //   - m-blake, active but on ZERO projects — the gap called out in
  //     lib/test-env/README.md. This is the most common real state (someone who
  //     just joined) and nothing in the app was previously exercised against it.
  //   - m-wei and m-fatima, inactive/alumni, so "never hard-delete" is visible.
  // -------------------------------------------------------------------------

  {
    id: "m-rosa",
    fullName: "Rosa Delgado",
    email: "rdelgado@stanford.edu",
    phone: "(650) 555-1105",
    globalRole: "lead",
    status: "active",
    leadId: "m-marcus",
    primaryTeamId: "team-propulsion",
    classYear: 2027,
    major: "Aeronautics & Astronautics",
    joinedAt: "2026-03-25",
    skills: ["propulsion", "test operations"],
  },
  {
    id: "m-blake",
    fullName: "Blake Ferris",
    email: "bferris@stanford.edu",
    phone: "(650) 555-1112",
    globalRole: "member",
    status: "active",
    leadId: "m-james",
    classYear: 2029,
    major: "Undeclared",
    joinedAt: "2026-07-28",
    skills: [],
  },
  {
    id: "m-ines",
    fullName: "Inés Moreau",
    email: "imoreau@stanford.edu",
    phone: "(650) 555-1119",
    globalRole: "member",
    status: "active",
    leadId: "m-rosa",
    primaryTeamId: "team-propulsion",
    classYear: 2028,
    major: "Mechanical Engineering",
    joinedAt: "2026-04-22",
    skills: ["thermal", "testing"],
  },
  {
    id: "m-theo",
    fullName: "Theo Almeida",
    email: "talmeida@stanford.edu",
    phone: "(650) 555-1126",
    globalRole: "member",
    status: "active",
    leadId: "m-rosa",
    primaryTeamId: "team-propulsion",
    classYear: 2029,
    major: "Mechanical Engineering",
    joinedAt: "2026-05-18",
    skills: ["machining", "fabrication"],
  },
  {
    id: "m-yuki",
    fullName: "Yuki Tanaka",
    email: "ytanaka@stanford.edu",
    phone: "(650) 555-1133",
    globalRole: "member",
    status: "active",
    leadId: "m-marcus",
    primaryTeamId: "team-avionics",
    classYear: 2028,
    major: "Electrical Engineering",
    joinedAt: "2026-04-09",
    skills: ["firmware", "RF"],
  },
  {
    id: "m-priyanka",
    fullName: "Priyanka Shah",
    email: "pshah2@stanford.edu",
    phone: "(650) 555-1140",
    globalRole: "member",
    status: "active",
    leadId: "m-marcus",
    primaryTeamId: "team-avionics",
    classYear: 2029,
    major: "Computer Science",
    joinedAt: "2026-05-22",
    skills: ["embedded", "Rust"],
  },
  {
    id: "m-caleb",
    fullName: "Caleb Osei",
    email: "cosei@stanford.edu",
    phone: "(650) 555-1147",
    globalRole: "member",
    status: "active",
    leadId: "m-lena",
    primaryTeamId: "team-perception",
    classYear: 2028,
    major: "Computer Science",
    joinedAt: "2026-04-25",
    skills: ["deep learning", "computer vision"],
  },
  {
    id: "m-mira",
    fullName: "Mira Kaplan",
    email: "mkaplan@stanford.edu",
    phone: "(650) 555-1154",
    globalRole: "member",
    status: "active",
    leadId: "m-lena",
    primaryTeamId: "team-perception",
    classYear: 2029,
    major: "Symbolic Systems",
    joinedAt: "2026-06-14",
    skills: ["Python", "data"],
  },
  {
    id: "m-arjun",
    fullName: "Arjun Nair",
    email: "anair3@stanford.edu",
    phone: "(650) 555-1161",
    globalRole: "member",
    status: "active",
    leadId: "m-priya",
    primaryTeamId: "team-structures",
    classYear: 2028,
    major: "Aeronautics & Astronautics",
    joinedAt: "2026-04-30",
    skills: ["CAD", "structures"],
  },
  {
    id: "m-elena",
    fullName: "Elena Petrova",
    email: "epetrova@stanford.edu",
    phone: "(650) 555-1168",
    globalRole: "member",
    status: "active",
    leadId: "m-priya",
    primaryTeamId: "team-structures",
    classYear: 2029,
    major: "Mechanical Engineering",
    joinedAt: "2026-05-27",
    skills: ["FEA", "CAD"],
  },
  {
    id: "m-jonas",
    fullName: "Jonas Weber",
    email: "jweber@stanford.edu",
    phone: "(650) 555-1175",
    globalRole: "member",
    status: "active",
    leadId: "m-dev",
    primaryTeamId: "team-composites",
    classYear: 2028,
    major: "Materials Science",
    joinedAt: "2026-06-08",
    skills: ["composites", "layup"],
  },
  {
    id: "m-aisha",
    fullName: "Aisha Rahman",
    email: "arahman@stanford.edu",
    phone: "(650) 555-1182",
    globalRole: "member",
    status: "active",
    leadId: "m-dev",
    primaryTeamId: "team-composites",
    classYear: 2029,
    major: "Chemical Engineering",
    joinedAt: "2026-06-20",
    skills: ["resins", "testing"],
  },
  {
    id: "m-daniel",
    fullName: "Daniel Cho",
    email: "dcho@stanford.edu",
    phone: "(650) 555-1189",
    globalRole: "member",
    status: "active",
    leadId: "m-james",
    classYear: 2028,
    major: "Product Design",
    joinedAt: "2026-05-14",
    skills: ["design", "prototyping"],
  },
  {
    id: "m-sara",
    fullName: "Sara Lindqvist",
    email: "slindqvist@stanford.edu",
    phone: "(650) 555-1196",
    globalRole: "member",
    status: "active",
    leadId: "m-james",
    classYear: 2029,
    major: "Communication",
    joinedAt: "2026-06-25",
    skills: ["outreach", "writing"],
  },
  {
    id: "m-victor",
    fullName: "Victor Nkemelu",
    email: "vnkemelu@stanford.edu",
    phone: "(650) 555-1203",
    globalRole: "member",
    status: "active",
    leadId: "m-rosa",
    primaryTeamId: "team-propulsion",
    classYear: 2028,
    major: "Aeronautics & Astronautics",
    joinedAt: "2026-05-06",
    skills: ["propulsion", "CFD"],
  },
  {
    id: "m-lucia",
    fullName: "Lucía Fernández",
    email: "lfernandez@stanford.edu",
    phone: "(650) 555-1210",
    globalRole: "member",
    status: "active",
    leadId: "m-lena",
    primaryTeamId: "team-perception",
    classYear: 2028,
    major: "Electrical Engineering",
    joinedAt: "2026-04-28",
    skills: ["sensors", "calibration"],
  },
  {
    id: "m-owen",
    fullName: "Owen Bradshaw",
    email: "obradshaw@stanford.edu",
    phone: "(650) 555-1217",
    globalRole: "member",
    status: "active",
    leadId: "m-marcus",
    primaryTeamId: "team-avionics",
    classYear: 2029,
    major: "Electrical Engineering",
    joinedAt: "2026-07-02",
    skills: ["PCB design"],
  },
  {
    id: "m-nadia",
    fullName: "Nadia Haddad",
    email: "nhaddad@stanford.edu",
    phone: "(650) 555-1224",
    globalRole: "member",
    status: "active",
    leadId: "m-priya",
    primaryTeamId: "team-structures",
    classYear: 2027,
    major: "Civil Engineering",
    joinedAt: "2026-04-03",
    skills: ["structures", "analysis"],
  },
  {
    id: "m-wei",
    fullName: "Wei Zhang",
    email: "wzhang@stanford.edu",
    phone: "(650) 555-1231",
    globalRole: "member",
    // On leave for a quarter. Deactivated, never deleted — the history has to
    // survive, and "who's on what" would be a lie if they still appeared active.
    status: "inactive",
    leadId: "m-lena",
    primaryTeamId: "team-perception",
    classYear: 2028,
    major: "Computer Science",
    joinedAt: "2026-04-11",
    skills: ["SLAM"],
  },
  {
    id: "m-fatima",
    fullName: "Fatima Al-Sayed",
    email: "falsayed@stanford.edu",
    globalRole: "member",
    status: "alumni",
    leadId: "m-priya",
    primaryTeamId: "team-structures",
    classYear: 2026,
    major: "Aeronautics & Astronautics",
    joinedAt: "2026-01-15",
    skills: ["CAD", "composites"],
  },
];

export const CURRENT_USER_ID = "m-anish";

// ---------------------------------------------------------------------------
// Projects — nested, multiple REs allowed
// ---------------------------------------------------------------------------

export const projects: Project[] = [
  {
    id: "p-airframe-v2",
    name: "eVTOL Airframe v2",
    slug: "evtol-airframe-v2",
    description:
      "Second-generation transitioning airframe targeting 4 kg payload at 30 km range.",
    parentId: null,
    teamId: "div-evtol",
    primaryReId: "m-priya",
    reIds: ["m-priya", "m-tyler"],
    phase: "detailed_design",
    health: "on_track",
    startDate: "2026-04-01",
    targetDate: "2026-12-15",
    datesOverridden: true,
    isOpenToJoin: true,
    openRoles: "FEA, tooling design",
    timeCommitment: "~6 hrs/week",
  },
  {
    id: "p-wing-spar",
    name: "Wing Spar Redesign",
    slug: "wing-spar-redesign",
    description: "Carbon spar reducing mass 18% while holding 3.5g limit load.",
    parentId: "p-airframe-v2",
    teamId: "team-structures",
    primaryReId: "m-tyler",
    reIds: ["m-tyler"],
    phase: "detailed_design",
    health: "at_risk",
    startDate: "2026-05-01",
    targetDate: "2026-09-30",
    datesOverridden: true,
    isOpenToJoin: true,
    openRoles: "FEA support",
    timeCommitment: "~4 hrs/week",
  },
  {
    id: "p-layup",
    name: "Layup Process Qualification",
    slug: "layup-process-qualification",
    description: "Repeatable wet layup procedure with coupon testing.",
    parentId: "p-wing-spar",
    teamId: "team-composites",
    primaryReId: "m-sofia",
    reIds: ["m-sofia"],
    phase: "manufacturing",
    health: "on_track",
    startDate: "2026-06-01",
    targetDate: "2026-08-30",
    datesOverridden: true,
    isOpenToJoin: true,
    timeCommitment: "~3 hrs/week",
  },
  {
    id: "p-load-test",
    name: "Spar Load Testing",
    slug: "spar-load-testing",
    description: "Static load rig and instrumented failure testing.",
    parentId: "p-wing-spar",
    teamId: "team-structures",
    primaryReId: "m-noah",
    reIds: ["m-noah"],
    phase: "integration",
    health: "on_track",
    startDate: "2026-07-15",
    targetDate: "2026-10-15",
    datesOverridden: true,
    isOpenToJoin: true,
    openRoles: "instrumentation, data acquisition",
    timeCommitment: "~4 hrs/week",
  },
  {
    id: "p-gps-denied",
    name: "GPS-Denied Navigation",
    slug: "gps-denied-navigation",
    description: "Visual-inertial odometry stack for indoor and urban flight.",
    parentId: null,
    teamId: "div-spade",
    primaryReId: "m-lena",
    reIds: ["m-lena", "m-amara"],
    phase: "testing",
    health: "on_track",
    startDate: "2026-04-15",
    targetDate: "2026-11-30",
    datesOverridden: true,
    isOpenToJoin: true,
    openRoles: "SLAM tuning, dataset collection",
    timeCommitment: "~6 hrs/week",
  },
  {
    id: "p-vio",
    name: "VIO Pipeline",
    slug: "vio-pipeline",
    description: "Real-time visual-inertial odometry on companion compute.",
    parentId: "p-gps-denied",
    teamId: "team-perception",
    primaryReId: "m-amara",
    reIds: ["m-amara"],
    phase: "testing",
    health: "on_track",
    startDate: "2026-05-01",
    targetDate: "2026-10-01",
    datesOverridden: true,
    isOpenToJoin: true,
    timeCommitment: "~5 hrs/week",
  },
  {
    id: "p-sim",
    name: "Simulation Environment",
    slug: "simulation-environment",
    description: "Gazebo world and scripted scenarios for regression testing.",
    parentId: "p-gps-denied",
    teamId: "team-perception",
    primaryReId: "m-omar",
    reIds: ["m-omar"],
    phase: "manufacturing",
    health: "blocked",
    startDate: "2026-06-01",
    targetDate: "2026-09-15",
    datesOverridden: true,
    isOpenToJoin: true,
    openRoles: "ROS 2 migration help",
    timeCommitment: "~3 hrs/week",
  },
  {
    id: "p-avionics-bringup",
    name: "Avionics Bring-Up",
    slug: "avionics-bring-up",
    description: "Flight controller integration, power distribution, telemetry.",
    parentId: null,
    teamId: "div-skybeta",
    primaryReId: "m-marcus",
    reIds: ["m-marcus", "m-kenji"],
    phase: "integration",
    health: "on_track",
    startDate: "2026-04-20",
    targetDate: "2026-10-30",
    datesOverridden: true,
    isOpenToJoin: true,
    openRoles: "firmware, harness fabrication",
    timeCommitment: "~5 hrs/week",
  },
  {
    id: "p-power",
    name: "Power Distribution Board",
    slug: "power-distribution-board",
    description: "Custom PDB with current sensing and redundant BEC.",
    parentId: "p-avionics-bringup",
    teamId: "team-avionics",
    primaryReId: "m-kenji",
    reIds: ["m-kenji"],
    phase: "detailed_design",
    health: "on_track",
    startDate: "2026-06-15",
    targetDate: "2026-09-01",
    datesOverridden: true,
    isOpenToJoin: true,
    timeCommitment: "~4 hrs/week",
  },
  {
    id: "p-propulsion-test",
    name: "Propulsion Test Stand",
    slug: "propulsion-test-stand",
    description: "Thrust and efficiency characterization for candidate motors.",
    parentId: null,
    teamId: "team-propulsion",
    primaryReId: "m-hana",
    reIds: ["m-hana"],
    phase: "manufacturing",
    health: "on_track",
    startDate: "2026-05-20",
    targetDate: "2026-09-20",
    datesOverridden: true,
    isOpenToJoin: true,
    openRoles: "load cell calibration",
    timeCommitment: "~4 hrs/week",
  },
  {
    id: "p-outreach",
    name: "Fall Workshop Series",
    slug: "fall-workshop-series",
    description: "Four beginner build workshops for new members.",
    parentId: null,
    teamId: "div-dronehacks",
    primaryReId: "m-james",
    reIds: ["m-james", "m-grace"],
    phase: "requirements",
    health: "on_track",
    startDate: "2026-08-01",
    targetDate: "2026-11-15",
    datesOverridden: true,
    isOpenToJoin: true,
    openRoles: "instructors, curriculum",
    timeCommitment: "~2 hrs/week",
  },
  {
    id: "p-skydelta-concept",
    name: "SkyDelta Concept Study",
    slug: "skydelta-concept-study",
    description: "Trade study for the next-generation delivery airframe.",
    parentId: null,
    teamId: "div-skydelta",
    primaryReId: "m-priya",
    reIds: ["m-priya"],
    phase: "concept",
    health: "on_track",
    startDate: "2026-07-01",
    targetDate: "2027-01-31",
    datesOverridden: true,
    isOpenToJoin: true,
    openRoles: "sizing analysis, mission modeling",
    timeCommitment: "~3 hrs/week",
  },
];

export const projectMemberships: ProjectMembership[] = [
  // Current user, so "My Work" has something to show
  { projectId: "p-gps-denied", memberId: "m-anish", role: "contributor", responsibility: "Mission requirements and flight-test coordination", joinedAt: "2026-04-16", commitment: "committed" },
  { projectId: "p-skydelta-concept", memberId: "m-anish", role: "re", responsibility: "Trade study scope and sizing review", joinedAt: "2026-07-01", commitment: "committed" },
  // Following: he chose to watch this one, nobody added him to it
  { projectId: "p-avionics-bringup", memberId: "m-anish", role: "observer", joinedAt: "2026-05-06", commitment: "following" },

  { projectId: "p-airframe-v2", memberId: "m-priya", role: "re", responsibility: "Overall airframe integration", joinedAt: "2026-04-01", commitment: "committed" },
  { projectId: "p-airframe-v2", memberId: "m-tyler", role: "re", responsibility: "Structural analysis", joinedAt: "2026-05-01", commitment: "committed" },
  { projectId: "p-airframe-v2", memberId: "m-sofia", role: "contributor", responsibility: "Composite fabrication", joinedAt: "2026-05-04", commitment: "committed" },
  { projectId: "p-wing-spar", memberId: "m-tyler", role: "re", responsibility: "Spar design and analysis", joinedAt: "2026-05-01", commitment: "committed" },
  { projectId: "p-wing-spar", memberId: "m-noah", role: "contributor", responsibility: "Material characterization", joinedAt: "2026-06-02", commitment: "committed" },
  { projectId: "p-layup", memberId: "m-sofia", role: "re", responsibility: "Process documentation", joinedAt: "2026-06-01", commitment: "committed" },
  { projectId: "p-layup", memberId: "m-noah", role: "contributor", responsibility: "Coupon testing", joinedAt: "2026-06-10", commitment: "committed" },
  { projectId: "p-load-test", memberId: "m-noah", role: "re", responsibility: "Test rig and instrumentation", joinedAt: "2026-07-15", commitment: "committed" },
  { projectId: "p-gps-denied", memberId: "m-lena", role: "re", responsibility: "Autonomy architecture", joinedAt: "2026-04-15", commitment: "committed" },
  { projectId: "p-gps-denied", memberId: "m-amara", role: "re", responsibility: "Perception stack", joinedAt: "2026-04-20", commitment: "committed" },
  { projectId: "p-vio", memberId: "m-amara", role: "re", responsibility: "VIO implementation", joinedAt: "2026-05-01", commitment: "committed" },
  { projectId: "p-vio", memberId: "m-omar", role: "contributor", responsibility: "Dataset collection", joinedAt: "2026-05-20", commitment: "committed" },
  { projectId: "p-sim", memberId: "m-omar", role: "re", responsibility: "Simulation environment", joinedAt: "2026-06-01", commitment: "committed" },
  { projectId: "p-avionics-bringup", memberId: "m-marcus", role: "re", responsibility: "Avionics integration", joinedAt: "2026-04-20", commitment: "committed" },
  { projectId: "p-avionics-bringup", memberId: "m-kenji", role: "re", responsibility: "Electronics design", joinedAt: "2026-04-25", commitment: "committed" },
  { projectId: "p-power", memberId: "m-kenji", role: "re", responsibility: "PDB schematic and layout", joinedAt: "2026-06-15", commitment: "committed" },
  { projectId: "p-propulsion-test", memberId: "m-hana", role: "re", responsibility: "Test stand and data", joinedAt: "2026-05-20", commitment: "committed" },
  { projectId: "p-outreach", memberId: "m-james", role: "re", responsibility: "Workshop program", joinedAt: "2026-08-01", commitment: "committed" },
  { projectId: "p-outreach", memberId: "m-grace", role: "re", responsibility: "Curriculum and logistics", joinedAt: "2026-08-01", commitment: "committed" },
  { projectId: "p-skydelta-concept", memberId: "m-priya", role: "re", responsibility: "Trade study lead", joinedAt: "2026-07-01", commitment: "committed" },

  // --- The wider club -------------------------------------------------------
  // Note m-blake appears NOWHERE below. That's deliberate: a brand-new member on
  // no projects is the state /find-work exists to fix, and it was previously
  // unrepresentable in mock data.
  { projectId: "p-propulsion-test", memberId: "m-rosa", role: "re", responsibility: "Propulsion test campaign", joinedAt: "2026-04-02", commitment: "committed" },
  { projectId: "p-propulsion-test", memberId: "m-ines", role: "contributor", responsibility: "Thermal instrumentation", joinedAt: "2026-05-01", commitment: "committed" },
  { projectId: "p-propulsion-test", memberId: "m-theo", role: "contributor", responsibility: "Stand fabrication", joinedAt: "2026-05-20", commitment: "committed" },
  { projectId: "p-propulsion-test", memberId: "m-victor", role: "contributor", responsibility: "CFD correlation", joinedAt: "2026-05-10", commitment: "committed" },
  { projectId: "p-avionics-bringup", memberId: "m-yuki", role: "contributor", responsibility: "Telemetry link", joinedAt: "2026-04-12", commitment: "committed" },
  { projectId: "p-avionics-bringup", memberId: "m-priyanka", role: "contributor", responsibility: "Flight-controller firmware", joinedAt: "2026-05-25", commitment: "committed" },
  { projectId: "p-power", memberId: "m-owen", role: "contributor", responsibility: "Connector selection", joinedAt: "2026-07-05", commitment: "committed" },
  { projectId: "p-vio", memberId: "m-caleb", role: "contributor", responsibility: "Feature-tracker tuning", joinedAt: "2026-04-28", commitment: "committed" },
  { projectId: "p-vio", memberId: "m-lucia", role: "contributor", responsibility: "Camera calibration", joinedAt: "2026-05-02", commitment: "committed" },
  { projectId: "p-sim", memberId: "m-mira", role: "contributor", responsibility: "Scenario scripting", joinedAt: "2026-06-18", commitment: "committed" },
  { projectId: "p-gps-denied", memberId: "m-caleb", role: "contributor", responsibility: "Re-localisation experiments", joinedAt: "2026-06-01", commitment: "committed" },
  { projectId: "p-airframe-v2", memberId: "m-arjun", role: "contributor", responsibility: "Fuselage CAD", joinedAt: "2026-05-02", commitment: "committed" },
  { projectId: "p-wing-spar", memberId: "m-elena", role: "contributor", responsibility: "FEA support", joinedAt: "2026-06-01", commitment: "committed" },
  { projectId: "p-wing-spar", memberId: "m-nadia", role: "contributor", responsibility: "Load case definition", joinedAt: "2026-04-10", commitment: "committed" },
  { projectId: "p-layup", memberId: "m-jonas", role: "contributor", responsibility: "Layup assistance", joinedAt: "2026-06-12", commitment: "committed" },
  { projectId: "p-layup", memberId: "m-aisha", role: "contributor", responsibility: "Resin characterisation", joinedAt: "2026-06-22", commitment: "committed" },
  { projectId: "p-load-test", memberId: "m-elena", role: "contributor", responsibility: "Strain gauge layout", joinedAt: "2026-07-20", commitment: "committed" },
  { projectId: "p-outreach", memberId: "m-daniel", role: "contributor", responsibility: "Workshop materials", joinedAt: "2026-05-20", commitment: "committed" },
  { projectId: "p-outreach", memberId: "m-sara", role: "contributor", responsibility: "School outreach", joinedAt: "2026-06-26", commitment: "committed" },
  { projectId: "p-skydelta-concept", memberId: "m-nadia", role: "contributor", responsibility: "Structural sizing", joinedAt: "2026-07-04", commitment: "committed" },
  // Following, not committed — watching without obligations.
  { projectId: "p-gps-denied", memberId: "m-priyanka", role: "observer", joinedAt: "2026-06-30", commitment: "following" },
  { projectId: "p-airframe-v2", memberId: "m-theo", role: "observer", joinedAt: "2026-07-11", commitment: "following" },
];

// ---------------------------------------------------------------------------
// Project artifacts
// ---------------------------------------------------------------------------

export const projectArtifacts: ProjectArtifact[] = [
  { id: "a-1", projectId: "p-airframe-v2", kind: "presentation", title: "Airframe v2 PDR slides", externalUrl: "https://drive.google.com/skyrunners/pdr-airframe-v2", version: "rev C", uploadedById: "m-priya", createdAt: "2026-06-12" },
  { id: "a-2", projectId: "p-airframe-v2", kind: "requirements", title: "Airframe requirements baseline", description: "42 requirements, 8 verified.", externalUrl: "https://drive.google.com/skyrunners/airframe-reqs", version: "v1.2", uploadedById: "m-priya", createdAt: "2026-05-30" },
  { id: "a-3", projectId: "p-airframe-v2", kind: "cad", title: "Full assembly (Onshape)", externalUrl: "https://cad.onshape.com/documents/skyrunners-airframe-v2", uploadedById: "m-tyler", createdAt: "2026-06-02" },
  { id: "a-4", projectId: "p-airframe-v2", kind: "analysis", title: "Mass budget spreadsheet", externalUrl: "https://docs.google.com/spreadsheets/skyrunners-mass-budget", uploadedById: "m-tyler", createdAt: "2026-08-01" },

  { id: "a-5", projectId: "p-wing-spar", kind: "analysis", title: "Spar FEA results, 3.5g load case", description: "Abaqus run with the updated layup schedule.", externalUrl: "https://drive.google.com/skyrunners/spar-fea", uploadedById: "m-tyler", createdAt: "2026-08-05" },
  { id: "a-6", projectId: "p-wing-spar", kind: "cad", title: "Spar geometry v3", externalUrl: "https://cad.onshape.com/documents/skyrunners-spar-v3", version: "v3", uploadedById: "m-tyler", createdAt: "2026-07-22" },

  { id: "a-7", projectId: "p-layup", kind: "doc", title: "Wet layup procedure (draft)", description: "Step-by-step with cure schedule. Needs review before it's the official process.", externalUrl: "https://docs.google.com/document/skyrunners-layup-procedure", uploadedById: "m-sofia", createdAt: "2026-07-28" },
  { id: "a-8", projectId: "p-layup", kind: "test_report", title: "Coupon batch 1 tensile results", externalUrl: "https://drive.google.com/skyrunners/coupon-batch-1", uploadedById: "m-noah", createdAt: "2026-07-30" },

  { id: "a-9", projectId: "p-gps-denied", kind: "presentation", title: "Autonomy architecture review", externalUrl: "https://drive.google.com/skyrunners/autonomy-arch", uploadedById: "m-lena", createdAt: "2026-06-15" },
  { id: "a-10", projectId: "p-gps-denied", kind: "requirements", title: "Mission requirements", description: "Baselined. 30km range, 4kg payload, GPS-denied for the final 500m.", externalUrl: "https://docs.google.com/document/skyrunners-mission-reqs", version: "v1.0", uploadedById: "m-anish", createdAt: "2026-07-02" },

  { id: "a-11", projectId: "p-vio", kind: "github", title: "skyrunners/vio-pipeline", description: "Main branch runs on the companion compute.", externalUrl: "https://github.com/4deg-kelvin/vio-pipeline", uploadedById: "m-amara", createdAt: "2026-05-10" },
  { id: "a-12", projectId: "p-vio", kind: "test_report", title: "Indoor drift test, 50m runs", description: "Holding under 30cm across 12 runs.", externalUrl: "https://drive.google.com/skyrunners/vio-drift-indoor", uploadedById: "m-amara", createdAt: "2026-08-04" },

  { id: "a-13", projectId: "p-sim", kind: "github", title: "skyrunners/gazebo-worlds", externalUrl: "https://github.com/4deg-kelvin/gazebo-worlds", uploadedById: "m-omar", createdAt: "2026-06-05" },

  { id: "a-14", projectId: "p-power", kind: "cad", title: "PDB schematic + layout (KiCad)", externalUrl: "https://github.com/4deg-kelvin/skyrunners-pdb", version: "rev B", uploadedById: "m-kenji", createdAt: "2026-07-28" },
  { id: "a-15", projectId: "p-power", kind: "requirements", title: "Power budget and PDB requirements", externalUrl: "https://docs.google.com/spreadsheets/skyrunners-power-budget", uploadedById: "m-marcus", createdAt: "2026-06-20" },

  { id: "a-16", projectId: "p-propulsion-test", kind: "drawing", title: "Test stand fabrication drawings", externalUrl: "https://drive.google.com/skyrunners/test-stand-drawings", uploadedById: "m-hana", createdAt: "2026-06-28" },

  { id: "a-17", projectId: "p-skydelta-concept", kind: "analysis", title: "Sizing trade study (in progress)", description: "Comparing four configurations against the mission profile.", externalUrl: "https://docs.google.com/spreadsheets/skyrunners-skydelta-sizing", uploadedById: "m-anish", createdAt: "2026-08-04" },
];

export function artifactsFor(projectId: string): ProjectArtifact[] {
  return live()
    .projectArtifacts.filter((a) => a.projectId === projectId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ---------------------------------------------------------------------------
// Join requests — the RE gate, made visible
// ---------------------------------------------------------------------------

export const joinRequests: JoinRequest[] = [
  {
    id: "jr-1",
    projectId: "p-load-test",
    memberId: "m-grace",
    note: "I want to learn instrumentation and data acquisition — happy to start on wiring.",
    status: "pending",
    requestedAt: "2026-08-04",
  },
  {
    id: "jr-2",
    projectId: "p-vio",
    memberId: "m-tyler",
    note: "Interested in the perception side; I've done some OpenCV work.",
    status: "pending",
    // Deliberately stale, to demonstrate escalation
    requestedAt: "2026-07-28",
  },
  {
    id: "jr-3",
    projectId: "p-power",
    memberId: "m-sofia",
    note: "Would like to pick up soldering and board bring-up.",
    status: "accepted",
    requestedAt: "2026-07-01",
    decidedAt: "2026-07-02",
    decidedById: "m-kenji",
  },
];

// ---------------------------------------------------------------------------
// Live data
// ---------------------------------------------------------------------------

/**
 * The mutable collections, read through the disk store rather than the literals
 * below.
 *
 * The arrays in this file are the SEED. Once something has been written — an
 * hour logged, a deliverable signed off — the truth lives in .data/store.json,
 * and a helper still reading the literal would show the user their change
 * silently vanishing on the next render.
 *
 * Static entities (members, projects, teams) are NOT in the store and are still
 * read straight from the literals: nothing in phases 2-4 creates them, and
 * copying them would mean two sources of truth for the org chart.
 *
 * The import cycle here (mock-data -> store/disk -> mock-data) is real but safe:
 * neither module touches the other at evaluation time.  reads these
 * arrays lazily, and  is only ever called from inside a function.
 */
function live() {
  return readStore();
}

export function pendingRequestsFor(projectId: string): JoinRequest[] {
  return live().joinRequests.filter(
    (r) => r.projectId === projectId && r.status === "pending"
  );
}

export function myJoinRequests(memberId: string) {
  return live().joinRequests
    .filter((r) => r.memberId === memberId)
    .map((r) => ({
      request: r,
      project: getProject(r.projectId),
      isStale:
        r.status === "pending" &&
        daysBetween(r.requestedAt, today()) >= JOIN_REQUEST_STALE_DAYS,
    }));
}

/**
 * Requests waiting on the current user as an RE — their queue.
 *
 * This is the obligation that comes with RE-controlled membership: if you
 * control the gate, you owe people an answer.
 */
export function joinRequestsAwaitingMe(memberId: string) {
  return live().joinRequests
    .filter((r) => r.status === "pending")
    .filter((r) => getProject(r.projectId)?.reIds.includes(memberId))
    .map((r) => ({
      request: r,
      project: getProject(r.projectId),
      requester: getMember(r.memberId),
      isStale: daysBetween(r.requestedAt, today()) >= JOIN_REQUEST_STALE_DAYS,
    }));
}

/** Requests nobody has answered in too long — a silent RE blocks a member. */
export function staleJoinRequests() {
  return live().joinRequests
    .filter(
      (r) =>
        r.status === "pending" &&
        daysBetween(r.requestedAt, today()) >= JOIN_REQUEST_STALE_DAYS
    )
    .map((r) => ({
      request: r,
      project: getProject(r.projectId),
      requester: getMember(r.memberId),
      daysWaiting: Math.round(daysBetween(r.requestedAt, today())),
    }));
}

// ---------------------------------------------------------------------------
// Deliverables — one flat list per project, one owner each
// ---------------------------------------------------------------------------

export const deliverables: Deliverable[] = [
  // Wing spar redesign
  { id: "d-1", projectId: "p-wing-spar", title: "Spar FEA converged at 3.5g limit load", ownerId: "m-tyler", dueDate: "2026-08-15", status: "in_progress", sortOrder: 1 },
  { id: "d-2", projectId: "p-wing-spar", title: "Mass reduction options memo for CDR", ownerId: "m-tyler", dueDate: "2026-08-12", status: "open", sortOrder: 2 },
  { id: "d-3", projectId: "p-wing-spar", title: "Material allowables from coupon data", ownerId: "m-noah", dueDate: "2026-07-30", status: "blocked", blockerNote: "Waiting on coupon results from the layup project.", sortOrder: 3 },
  { id: "d-4", projectId: "p-wing-spar", title: "Preliminary spar geometry in CAD", ownerId: "m-tyler", status: "done", completedAt: "2026-06-20", sortOrder: 4 },

  // Layup qualification
  { id: "d-5", projectId: "p-layup", title: "Wet layup procedure written and reviewed", ownerId: "m-sofia", dueDate: "2026-08-20", status: "in_progress", sortOrder: 1 },
  { id: "d-6", projectId: "p-layup", title: "Six coupons cured within spec", ownerId: "m-sofia", dueDate: "2026-08-25", status: "blocked", blockerNote: "Vacuum pump seal is leaking.", sortOrder: 2 },
  { id: "d-7", projectId: "p-layup", title: "Coupon tensile test report", ownerId: "m-noah", dueDate: "2026-08-28", status: "open", sortOrder: 3 },
  { id: "d-8", projectId: "p-layup", title: "Tooling fabricated", ownerId: "m-sofia", status: "done", completedAt: "2026-07-10", sortOrder: 4 },

  // Airframe v2
  { id: "d-9", projectId: "p-airframe-v2", title: "Mass budget updated with spar estimate", ownerId: "m-tyler", dueDate: "2026-08-14", status: "in_progress", sortOrder: 1 },
  { id: "d-10", projectId: "p-airframe-v2", title: "CDR package assembled", ownerId: "m-priya", dueDate: "2026-08-11", status: "in_progress", sortOrder: 2 },
  { id: "d-11", projectId: "p-airframe-v2", title: "Interface control document v1", ownerId: "m-priya", status: "done", completedAt: "2026-06-28", sortOrder: 3 },

  // GPS-denied navigation
  { id: "d-12", projectId: "p-gps-denied", title: "Flight-test plan for outdoor VIO runs", ownerId: "m-anish", dueDate: "2026-08-18", status: "in_progress", sortOrder: 1 },
  { id: "d-13", projectId: "p-gps-denied", title: "Mission requirements baselined", ownerId: "m-anish", status: "done", completedAt: "2026-07-02", sortOrder: 2 },
  { id: "d-14", projectId: "p-gps-denied", title: "Autonomy architecture diagram", ownerId: "m-lena", status: "done", completedAt: "2026-06-15", sortOrder: 3 },

  // VIO pipeline
  { id: "d-15", projectId: "p-vio", title: "Drift under 30cm over 50m indoors", ownerId: "m-amara", status: "done", completedAt: "2026-08-04", sortOrder: 1 },
  { id: "d-16", projectId: "p-vio", title: "Outdoor dataset collected and labelled", ownerId: "m-omar", dueDate: "2026-08-22", status: "open", sortOrder: 2 },

  // Simulation
  { id: "d-17", projectId: "p-sim", title: "ROS 2 migration of the Gazebo world", ownerId: "m-omar", dueDate: "2026-07-25", status: "blocked", blockerNote: "Plugin API changed; need guidance on whether to pin ROS 1.", sortOrder: 1 },

  // Power distribution board
  { id: "d-18", projectId: "p-power", title: "PDB schematic complete", ownerId: "m-kenji", status: "done", completedAt: "2026-07-28", sortOrder: 1 },
  { id: "d-19", projectId: "p-power", title: "Board routing finished and reviewed", ownerId: "m-kenji", dueDate: "2026-08-16", status: "in_progress", sortOrder: 2 },

  // Propulsion test stand
  { id: "d-20", projectId: "p-propulsion-test", title: "Test stand frame welded", ownerId: "m-hana", status: "done", completedAt: "2026-08-05", sortOrder: 1 },
  { id: "d-21", projectId: "p-propulsion-test", title: "Load cell calibrated", ownerId: "m-hana", dueDate: "2026-08-19", status: "blocked", blockerNote: "Need calibration weights — do we own any?", sortOrder: 2 },

  // SkyDelta concept study
  { id: "d-22", projectId: "p-skydelta-concept", title: "Mission sizing spreadsheet v1", ownerId: "m-anish", dueDate: "2026-08-29", status: "in_progress", sortOrder: 1 },
  { id: "d-23", projectId: "p-skydelta-concept", title: "Trade study scope agreed with Co-Leads", ownerId: "m-anish", status: "done", completedAt: "2026-07-20", sortOrder: 2 },

  // Outreach
  { id: "d-24", projectId: "p-outreach", title: "Four workshop lesson plans drafted", ownerId: "m-grace", dueDate: "2026-09-10", status: "open", sortOrder: 1 },
  { id: "d-25", projectId: "p-outreach", title: "Parts list and budget for workshop kits", ownerId: "m-james", dueDate: "2026-09-01", status: "open", sortOrder: 2 },

  // Load testing
  { id: "d-26", projectId: "p-load-test", title: "Load rig CAD complete", ownerId: "m-noah", dueDate: "2026-08-30", status: "in_progress", sortOrder: 1 },
  { id: "d-27", projectId: "p-load-test", title: "Instrumentation plan", ownerId: "m-noah", dueDate: "2026-09-15", status: "open", sortOrder: 2 },
];

// ---------------------------------------------------------------------------
// Trainings and facility access — the club's real catalogue
// ---------------------------------------------------------------------------

/**
 * The actual sites and machines, from Anish on 2026-08-08.
 *
 * This is a SEED, not a schema. Every row here is editable from the app and
 * Co-Leads will add to it — the whole point of the design is that a new
 * machine is a row, not a deploy. If you're reading this because the club has
 * a machine the list doesn't, add it in the UI rather than here.
 */
export const seedTrainingSections: TrainingSection[] = [
  { id: "sec-robotics", name: "Robotics Room", sortOrder: 1 },
  { id: "sec-lab64", name: "Lab 64", sortOrder: 2 },
  { id: "sec-prl", name: "PRL", sortOrder: 3 },
  { id: "sec-chip", name: "CHIP", sortOrder: 4 },
  // The catch-all. Anything that belongs to no site — an online course, a
  // flight-safety briefing — lands here rather than forcing a fake site.
  { id: "sec-misc", name: "Misc", sortOrder: 99 },
];

const item = (
  id: string,
  sectionId: string,
  name: string,
  kind: CatalogueItemKind,
  sortOrder: number
): CatalogueItem => ({ id, sectionId, name, kind, sortOrder, isActive: true });

export const seedCatalogueItems: CatalogueItem[] = [
  // --- site access: can you get in the door --------------------------------
  item("acc-robotics", "sec-robotics", "Robotics Room", "site_access", 0),
  item("acc-lab64", "sec-lab64", "Lab 64", "site_access", 0),
  // Separate from ordinary Lab 64 access, deliberately — it's a different
  // clearance, not a property of the first one.
  item("acc-lab64-24", "sec-lab64", "Lab 64 — 24 hour", "site_access", 1),
  item("acc-prl", "sec-prl", "PRL", "site_access", 0),
  item("acc-chip", "sec-chip", "CHIP", "site_access", 0),

  // --- Robotics Room machines ----------------------------------------------
  item("tr-rr-3dp", "sec-robotics", "3D printers", "machine", 10),
  item("tr-rr-h2d", "sec-robotics", "H2D Printer", "machine", 11),
  item("tr-rr-makera", "sec-robotics", "Makera desktop CNC", "machine", 12),
  item("tr-rr-battery", "sec-robotics", "Battery handling and soldering", "machine", 13),

  // --- Lab 64 machines ------------------------------------------------------
  item("tr-l64-prusa", "sec-lab64", "PRUSA 3D Printing", "machine", 10),
  item("tr-l64-trotec", "sec-lab64", "Trotec laser cutter", "machine", 11),
  item("tr-l64-fablight", "sec-lab64", "Fablight metal laser cutter", "machine", 12),
  item("tr-l64-solder", "sec-lab64", "Soldering", "machine", 13),
  item("tr-l64-machining", "sec-lab64", "Machining tools", "machine", 14),
  item("tr-l64-vapor", "sec-lab64", "Vapor Phase One", "machine", 15),
  item("tr-l64-reflow", "sec-lab64", "Reflow oven", "machine", 16),
  item("tr-l64-vacform", "sec-lab64", "Vacuum former", "machine", 17),

  // --- PRL -----------------------------------------------------------------
  //
  // Anish: "PRL has CNCs which require PRL training, else you only need to get
  // site access." So one machine entry, and everything else at PRL is covered
  // by the door.
  item("tr-prl-cnc", "sec-prl", "CNC machines", "machine", 10),

  // --- CHIP machines --------------------------------------------------------
  item("tr-chip-3dp", "sec-chip", "3D printers", "machine", 10),
  item("tr-chip-laser", "sec-chip", "Laser cutter", "machine", 11),
  item("tr-chip-electronics", "sec-chip", "Electronic equipment", "machine", 12),
];

// ---------------------------------------------------------------------------
// Academic calendar
// ---------------------------------------------------------------------------

/**
 * Obligations are generated ONLY inside terms where `generatesObligations` is
 * true. Without this, everyone accrues weeks of `missed` updates over finals and
 * breaks, and by autumn the contribution data is meaningless.
 */
export const terms: Term[] = [
  { id: "t-su26", name: "Summer 2026", kind: "summer", startsOn: "2026-06-15", endsOn: "2026-09-20", generatesObligations: false },
  { id: "t-au26", name: "Autumn 2026", kind: "quarter", startsOn: "2026-09-21", endsOn: "2026-12-04", generatesObligations: true },
  { id: "t-au26f", name: "Autumn finals", kind: "finals", startsOn: "2026-12-05", endsOn: "2026-12-12", generatesObligations: false },
  { id: "t-wbreak", name: "Winter break", kind: "break", startsOn: "2026-12-13", endsOn: "2027-01-04", generatesObligations: false },
  { id: "t-wi27", name: "Winter 2027", kind: "quarter", startsOn: "2027-01-05", endsOn: "2027-03-19", generatesObligations: true },
];

export function termFor(date: string): Term | undefined {
  return live().terms.find((t) => date >= t.startsOn && date <= t.endsOn);
}

export function inSession(date: string): boolean {
  return termFor(date)?.generatesObligations ?? false;
}

/** Current user's own update, so My Work shows the per-project layout. */
// The single hardcoded "my update" was removed: it keyed off CURRENT_USER_ID,
// so in live mode it showed one person's draft to everybody. `currentUpdateFor`
// resolves it per member from the store instead.

// ---------------------------------------------------------------------------
// Updates — 3x per week cadence
// ---------------------------------------------------------------------------

export const progressUpdates: ProgressUpdate[] = [
  {
    id: "u-1",
    memberId: "m-sofia",
    dueAt: "2026-08-05T23:59",
    submittedAt: "2026-08-05T21:14",
    status: "submitted",
    hoursThisPeriod: 6.5,
    entries: [
      {
        id: "ue-1",
        updateId: "u-1",
        projectId: "p-layup",
        progress: "Finished three coupon layups, two came out within spec.",
        blockers: "Vacuum pump seal is leaking.",
        nextSteps: "Replace seal, run remaining coupons.",
        hours: 6.5,
      },
    ],
  },
  {
    // Tyler works on two projects — separate entries keep it unambiguous
    id: "u-2",
    memberId: "m-tyler",
    dueAt: "2026-08-05T23:59",
    submittedAt: "2026-08-06T08:30",
    status: "late",
    hoursThisPeriod: 9,
    entries: [
      {
        id: "ue-2",
        updateId: "u-2",
        projectId: "p-wing-spar",
        progress: "Spar FEA converged. Mass down 14%.",
        blockers:
          "The 18% target may not be reachable without changing the layup schedule.",
        nextSteps: "Bring three options to the design review.",
        hours: 7,
      },
      {
        id: "ue-3",
        updateId: "u-2",
        projectId: "p-airframe-v2",
        progress: "Updated the mass budget with the new spar estimate.",
        nextSteps: "Re-check CG margins once the spar number is final.",
        hours: 2,
      },
    ],
  },
  {
    id: "u-3",
    memberId: "m-omar",
    dueAt: "2026-08-05T23:59",
    status: "missed",
    hoursThisPeriod: 1.5,
    entries: [],
  },
  {
    id: "u-4",
    memberId: "m-kenji",
    dueAt: "2026-08-05T23:59",
    submittedAt: "2026-08-05T18:02",
    status: "reviewed",
    hoursThisPeriod: 7,
    entries: [
      {
        id: "ue-4",
        updateId: "u-4",
        projectId: "p-power",
        progress: "PDB schematic complete, routing 60% done.",
        nextSteps: "Finish routing, send for review before fab.",
        hours: 7,
      },
    ],
  },
  {
    id: "u-5",
    memberId: "m-amara",
    dueAt: "2026-08-05T23:59",
    submittedAt: "2026-08-05T22:40",
    status: "submitted",
    hoursThisPeriod: 8.5,
    entries: [
      {
        id: "ue-5",
        updateId: "u-5",
        projectId: "p-vio",
        progress: "VIO holding under 30 cm drift over 50 m indoor runs.",
        nextSteps: "Outdoor testing next week.",
        hours: 8.5,
      },
    ],
  },
  {
    id: "u-6",
    memberId: "m-noah",
    dueAt: "2026-08-05T23:59",
    status: "pending",
    hoursThisPeriod: 4,
    entries: [],
  },
  {
    id: "u-7",
    memberId: "m-hana",
    dueAt: "2026-08-05T23:59",
    submittedAt: "2026-08-05T20:10",
    status: "submitted",
    hoursThisPeriod: 5.5,
    entries: [
      {
        id: "ue-6",
        updateId: "u-7",
        projectId: "p-propulsion-test",
        progress: "Test stand frame welded, load cell mounted.",
        blockers: "Waiting on calibration weights.",
        nextSteps: "Calibrate and run the first motor.",
        hours: 5.5,
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // Reports written and NOT yet read.
  //
  // today() is 2026-08-06 and the grace period is 3 days (lib/review.ts), so the
  // ages below are chosen to sit either side of the escalation boundary:
  //
  //   submitted 08-05 → 1 day  → unread, not escalated
  //   submitted 08-03 → 3 days → escalates, exactly on the boundary
  //   submitted 08-01 → 5 days → escalates
  //
  // Marcus and Lena each have escalating reports, so signing in as Anish (their
  // Co-Lead) shows a populated escalation list, and signing in as Marcus shows
  // his own unread queue. Priya has none — a Lead who IS keeping up, so the
  // healthy state is visible too.
  // ---------------------------------------------------------------------------

  {
    id: "u-8",
    memberId: "m-yuki",
    dueAt: "2026-08-01T23:59",
    submittedAt: "2026-08-01T18:40",
    status: "submitted",
    hoursThisPeriod: 7,
    entries: [
      {
        id: "ue-8",
        updateId: "u-8",
        projectId: "p-avionics-bringup",
        progress: "Telemetry link holding at 400 m line of sight.",
        blockers: "Packet loss climbs above 15% once the airframe blocks LOS.",
        nextSteps: "Try the higher-gain antenna Marcus mentioned.",
        hours: 7,
      },
    ],
  },
  {
    id: "u-9",
    memberId: "m-priyanka",
    dueAt: "2026-08-03T23:59",
    submittedAt: "2026-08-03T22:05",
    status: "submitted",
    hoursThisPeriod: 5,
    entries: [
      {
        id: "ue-9",
        updateId: "u-9",
        projectId: "p-avionics-bringup",
        progress: "Firmware builds clean on the new toolchain.",
        blockers: "I don't have Lab 64 access yet, so I can't flash hardware.",
        nextSteps: "Blocked until someone can badge me in.",
        hours: 5,
      },
    ],
  },
  {
    id: "u-10",
    memberId: "m-caleb",
    dueAt: "2026-08-01T23:59",
    submittedAt: "2026-08-01T09:15",
    status: "submitted",
    hoursThisPeriod: 6,
    entries: [
      {
        id: "ue-10",
        updateId: "u-10",
        projectId: "p-vio",
        progress: "Swapped the feature tracker; drift down roughly 20%.",
        nextSteps: "Re-run the full indoor set for comparable numbers.",
        hours: 6,
      },
    ],
  },
  {
    id: "u-11",
    memberId: "m-lucia",
    dueAt: "2026-08-05T23:59",
    submittedAt: "2026-08-05T19:30",
    status: "submitted",
    hoursThisPeriod: 3.5,
    entries: [
      {
        id: "ue-11",
        updateId: "u-11",
        projectId: "p-vio",
        progress: "Camera intrinsics re-calibrated; reprojection error halved.",
        hours: 3.5,
      },
    ],
  },
  {
    id: "u-12",
    memberId: "m-ines",
    dueAt: "2026-08-05T23:59",
    submittedAt: "2026-08-05T21:00",
    status: "reviewed",
    hoursThisPeriod: 4.5,
    entries: [
      {
        id: "ue-12",
        updateId: "u-12",
        projectId: "p-propulsion-test",
        progress: "Thermocouples wired and reading sensibly.",
        nextSteps: "Repeatability run once the stand is calibrated.",
        hours: 4.5,
      },
    ],
  },
  {
    id: "u-13",
    memberId: "m-arjun",
    dueAt: "2026-08-05T23:59",
    submittedAt: "2026-08-05T17:45",
    status: "reviewed",
    hoursThisPeriod: 5,
    entries: [
      {
        id: "ue-13",
        updateId: "u-13",
        projectId: "p-airframe-v2",
        progress: "Fuselage frames modelled through station 6.",
        hours: 5,
      },
    ],
  },
  {
    id: "u-14",
    memberId: "m-elena",
    dueAt: "2026-08-05T23:59",
    status: "missed",
    hoursThisPeriod: 0,
    entries: [],
  },
  {
    id: "u-15",
    memberId: "m-blake",
    dueAt: "2026-08-05T23:59",
    status: "pending",
    hoursThisPeriod: 0,
    entries: [],
  },
];

// ---------------------------------------------------------------------------
// Hours
// ---------------------------------------------------------------------------

export const workLogs: WorkLog[] = [
  { id: "w-me-1", memberId: "m-anish", projectId: "p-gps-denied", workDate: "2026-08-05", hours: 2.5, description: "Flight-test planning" },
  { id: "w-me-2", memberId: "m-anish", projectId: "p-gps-denied", workDate: "2026-08-03", hours: 2, description: "Requirements review" },
  { id: "w-me-3", memberId: "m-anish", projectId: "p-skydelta-concept", workDate: "2026-08-04", hours: 3, description: "Sizing spreadsheet" },
  { id: "w-1", memberId: "m-sofia", projectId: "p-layup", workDate: "2026-08-05", hours: 3, description: "Coupon layup" },
  { id: "w-2", memberId: "m-sofia", projectId: "p-layup", workDate: "2026-08-04", hours: 3.5, description: "Tooling prep" },
  { id: "w-3", memberId: "m-tyler", projectId: "p-wing-spar", workDate: "2026-08-05", hours: 4, description: "FEA runs" },
  { id: "w-4", memberId: "m-tyler", projectId: "p-wing-spar", workDate: "2026-08-03", hours: 5, description: "Mesh refinement" },
  { id: "w-5", memberId: "m-amara", projectId: "p-vio", workDate: "2026-08-05", hours: 4.5, description: "Drift tuning" },
  { id: "w-6", memberId: "m-amara", projectId: "p-vio", workDate: "2026-08-02", hours: 4, description: "Indoor test runs" },
  { id: "w-7", memberId: "m-kenji", projectId: "p-power", workDate: "2026-08-04", hours: 7, description: "PCB routing" },
  { id: "w-8", memberId: "m-hana", projectId: "p-propulsion-test", workDate: "2026-08-05", hours: 5.5, description: "Frame welding" },
  { id: "w-9", memberId: "m-noah", projectId: "p-load-test", workDate: "2026-08-03", hours: 4, description: "Rig CAD" },
  { id: "w-10", memberId: "m-omar", projectId: "p-sim", workDate: "2026-08-01", hours: 1.5, description: "ROS 2 migration attempt" },

  // --- The wider club's hours ------------------------------------------------
  // Spread across the week so "hours this week" and the per-project totals an RE
  // sees are non-trivial. m-blake has none, which is the point of m-blake.
  { id: "w-11", memberId: "m-yuki", projectId: "p-avionics-bringup", workDate: "2026-08-05", hours: 4, description: "Telemetry range testing" },
  { id: "w-12", memberId: "m-yuki", projectId: "p-avionics-bringup", workDate: "2026-08-02", hours: 3, description: "Antenna comparison" },
  { id: "w-13", memberId: "m-priyanka", projectId: "p-avionics-bringup", workDate: "2026-08-04", hours: 5, description: "Firmware toolchain migration" },
  { id: "w-14", memberId: "m-owen", projectId: "p-power", workDate: "2026-08-05", hours: 2, description: "Connector trade study" },
  { id: "w-15", memberId: "m-caleb", projectId: "p-vio", workDate: "2026-08-04", hours: 3.5, description: "Feature tracker swap" },
  { id: "w-16", memberId: "m-caleb", projectId: "p-gps-denied", workDate: "2026-08-01", hours: 2.5, description: "Re-localisation experiments" },
  { id: "w-17", memberId: "m-lucia", projectId: "p-vio", workDate: "2026-08-05", hours: 3.5, description: "Camera calibration" },
  { id: "w-18", memberId: "m-mira", projectId: "p-sim", workDate: "2026-08-03", hours: 2, description: "Scenario scripting" },
  { id: "w-19", memberId: "m-arjun", projectId: "p-airframe-v2", workDate: "2026-08-05", hours: 5, description: "Fuselage frame CAD" },
  { id: "w-20", memberId: "m-elena", projectId: "p-wing-spar", workDate: "2026-08-02", hours: 3, description: "FEA mesh support" },
  { id: "w-21", memberId: "m-nadia", projectId: "p-wing-spar", workDate: "2026-08-04", hours: 4.5, description: "Load case definition" },
  { id: "w-22", memberId: "m-nadia", projectId: "p-skydelta-concept", workDate: "2026-08-05", hours: 2, description: "Structural sizing pass" },
  { id: "w-23", memberId: "m-jonas", projectId: "p-layup", workDate: "2026-08-03", hours: 4, description: "Layup assistance" },
  { id: "w-24", memberId: "m-aisha", projectId: "p-layup", workDate: "2026-08-05", hours: 3, description: "Resin cure trials" },
  { id: "w-25", memberId: "m-ines", projectId: "p-propulsion-test", workDate: "2026-08-04", hours: 4.5, description: "Thermocouple wiring" },
  { id: "w-26", memberId: "m-theo", projectId: "p-propulsion-test", workDate: "2026-08-02", hours: 6, description: "Stand fabrication" },
  { id: "w-27", memberId: "m-victor", projectId: "p-propulsion-test", workDate: "2026-08-05", hours: 3.5, description: "CFD correlation" },
  { id: "w-28", memberId: "m-rosa", projectId: "p-propulsion-test", workDate: "2026-08-04", hours: 5, description: "Test campaign planning" },
  { id: "w-29", memberId: "m-daniel", projectId: "p-outreach", workDate: "2026-08-03", hours: 2.5, description: "Workshop materials" },
  { id: "w-30", memberId: "m-sara", projectId: "p-outreach", workDate: "2026-08-05", hours: 2, description: "School scheduling" },
];

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export const events: ClubEvent[] = [
  { id: "e-1", title: "Airframe v2 Critical Design Review", kind: "design_review", importanceWeight: 5, startsAt: "2026-08-12T16:00", endsAt: "2026-08-12T18:00", location: "Durand 450" },
  { id: "e-2", title: "Skydio Facility Tour", kind: "company_tour", importanceWeight: 4, startsAt: "2026-08-19T13:00", endsAt: "2026-08-19T16:00", location: "San Mateo" },
  { id: "e-3", title: "Weekly Build Session", kind: "build_session", importanceWeight: 2, startsAt: "2026-08-08T18:00", endsAt: "2026-08-08T21:00", location: "Robotics Room" },
  { id: "e-4", title: "Fall Kickoff Social", kind: "social", importanceWeight: 1, startsAt: "2026-09-25T18:30", location: "Lake Lag" },
  { id: "e-5", title: "Machine Shop Safety Training", kind: "training", importanceWeight: 3, startsAt: "2026-08-14T15:00", endsAt: "2026-08-14T17:00", location: "PRL" },
];

// ---------------------------------------------------------------------------
// Derived helpers — these become SQL views later
// ---------------------------------------------------------------------------

export function getMember(id: string) {
  return live().members.find((m) => m.id === id);
}

export function getProject(id: string) {
  return live().projects.find((p) => p.id === id);
}

export function directREs(projectId: string) {
  return getProject(projectId)?.reIds ?? [];
}

/**
 * Live divisions only.
 *
 * Every caller — the projects tree, the division picker, the dashboard count —
 * wants the club as it is now. An archived division appearing in a picker would
 * let somebody file new work into a division that isn't shown anywhere.
 * `archivedDivisions()` is the deliberate way to ask for the other set.
 */
export function divisions() {
  return live().teams.filter((t) => t.parentId === null && t.isActive);
}

/** Retired divisions, most recently archived first. The club's own record. */
export function archivedDivisions() {
  return live()
    .teams.filter((t) => t.parentId === null && !t.isActive)
    .sort((a, b) => (b.archivedAt ?? "").localeCompare(a.archivedAt ?? ""));
}

export function childTeams(parentId: string) {
  return live().teams.filter((t) => t.parentId === parentId);
}

export function childProjects(parentId: string | null) {
  return live().projects.filter((p) => p.parentId === parentId);
}

export function projectMembers(projectId: string) {
  return live().projectMemberships
    .filter((pm) => pm.projectId === projectId)
    .map((pm) => ({ ...pm, member: getMember(pm.memberId) }));
}

export function memberProjects(memberId: string) {
  return live().projectMemberships
    .filter((pm) => pm.memberId === memberId)
    .map((pm) => ({ ...pm, project: getProject(pm.projectId) }));
}

export function activeMembers() {
  return live().members.filter((m) => m.status === "active");
}

export function getTeam(id: string) {
  return live().teams.find((t) => t.id === id);
}

/**
 * Where a project sits, as a readable trail:
 *   "Fixed Wing eVTOL › eVTOL Airframe v2 › Wing Spar Redesign"
 *
 * This is what makes multi-project membership legible. "Layup Process" means
 * little on its own; showing that it lives under the spar redesign inside the
 * eVTOL division tells you instantly which piece of work it is.
 */
export function projectBreadcrumb(
  projectId: string
): { id: string; name: string; kind: "division" | "team" | "project" }[] {
  const project = getProject(projectId);
  if (!project) return [];

  // Walk up the project tree, collecting ancestors
  const projectTrail: typeof projects = [];
  const seen = new Set<string>();
  let current: string | null = project.parentId;
  while (current && !seen.has(current)) {
    seen.add(current);
    const p = getProject(current);
    if (!p) break;
    projectTrail.unshift(p);
    current = p.parentId;
  }

  // Then up the org tree from whichever unit owns the topmost project
  const owningTeamId = (projectTrail[0] ?? project).teamId;
  const teamTrail: { id: string; name: string; kind: "division" | "team" }[] = [];
  const seenTeams = new Set<string>();
  let currentTeam: string | null | undefined = owningTeamId;
  while (currentTeam && !seenTeams.has(currentTeam)) {
    seenTeams.add(currentTeam);
    const t = getTeam(currentTeam);
    if (!t) break;
    teamTrail.unshift({
      id: t.id,
      name: t.name,
      kind: t.parentId === null ? "division" : "team",
    });
    currentTeam = t.parentId;
  }

  return [
    ...teamTrail,
    ...projectTrail.map((p) => ({
      id: p.id,
      name: p.name,
      kind: "project" as const,
    })),
  ];
}

// ---------------------------------------------------------------------------
// Deliverables
// ---------------------------------------------------------------------------

export function projectDeliverables(projectId: string): Deliverable[] {
  return live().deliverables
    .filter((d) => d.projectId === projectId)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

/** What one person owns on one project — the "what am I responsible for" answer. */
export function myDeliverablesOn(
  memberId: string,
  projectId: string
): Deliverable[] {
  return projectDeliverables(projectId).filter((d) => d.ownerId === memberId);
}

export function myDeliverables(memberId: string): Deliverable[] {
  return live().deliverables
    .filter((d) => d.ownerId === memberId)
    .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"));
}

export function isOverdue(d: Deliverable): boolean {
  // `submitted` is excluded on purpose. The owner has finished and is waiting on
  // an RE to sign off — marking their work "overdue" because someone else is
  // slow blames the wrong person, and it's the exact unfairness the RE-confirms
  // rule risks introducing. The delay still surfaces, but against the RE, via
  // `pendingSignOffs()` in lib/review.ts.
  if (d.status === "done" || d.status === "submitted") return false;
  return !!d.dueDate && d.dueDate < today();
}

/** Real percentage rather than a vibe — the payoff of one flat list. */
export function projectProgress(projectId: string) {
  const list = projectDeliverables(projectId);
  const done = list.filter((d) => d.status === "done").length;
  const blocked = list.filter((d) => d.status === "blocked").length;
  const overdue = list.filter(isOverdue).length;
  return {
    total: list.length,
    done,
    blocked,
    overdue,
    fraction: list.length > 0 ? done / list.length : 0,
  };
}

/** Blockers surfaced from deliverables, so nobody waits for their update day. */
export function openBlockerDeliverables(): Deliverable[] {
  return live().deliverables.filter((d) => d.status === "blocked");
}

// ---------------------------------------------------------------------------
// RE liveness
// ---------------------------------------------------------------------------

/**
 * Stand-in for "last time this member did anything". Once auth is real this
 * comes from `profiles.last_active_at`.
 */
const MOCK_LAST_ACTIVE: Record<string, string> = {
  "m-omar": "2026-07-18", // deliberately stale, to demonstrate the flag
};

function lastActive(memberId: string): string {
  return MOCK_LAST_ACTIVE[memberId] ?? today();
}

/**
 * Projects that need leadership attention.
 *
 * Because RE authority inherits downward, an RE who quietly checks out freezes
 * their whole subtree — nobody beneath them can create sub-projects, appoint
 * REs, or get a blocker cleared. This is the check that surfaces it instead of
 * letting the work stall invisibly for a month.
 */
export function projectAttentionFlags(): ProjectAttentionFlag[] {
  const flags: ProjectAttentionFlag[] = [];

  // Live projects, not the seed literals: on a clean database this was still
  // producing attention flags for mock projects that do not exist.
  for (const project of live().projects) {
    const silentDays = daysBetween(lastActive(project.primaryReId), today());
    if (silentDays >= RE_SILENT_DAYS) {
      flags.push({
        projectId: project.id,
        reason: "re_silent",
        detail: `${getMember(project.primaryReId)?.fullName ?? "The RE"} hasn't been active in ${Math.round(silentDays)} days.`,
        severity: 3,
      });
    }

    // A project with children and only one RE has a single point of failure
    if (childProjects(project.id).length > 0 && project.reIds.length < 2) {
      flags.push({
        projectId: project.id,
        reason: "no_deputy_re",
        detail:
          "Has sub-projects but only one RE. Name a deputy so it doesn't stall if they're unavailable.",
        severity: 1,
      });
    }

    const stale = projectDeliverables(project.id).filter(
      (d) => d.status === "blocked"
    );
    if (stale.length > 0) {
      flags.push({
        projectId: project.id,
        reason: "blocker_stale",
        detail: `${stale.length} blocked deliverable${stale.length === 1 ? "" : "s"} waiting on an answer.`,
        severity: 2,
      });
    }

    const overdue = projectDeliverables(project.id).filter(isOverdue);
    if (overdue.length > 0) {
      flags.push({
        projectId: project.id,
        reason: "deliverables_overdue",
        detail: `${overdue.length} deliverable${overdue.length === 1 ? "" : "s"} past due.`,
        severity: 2,
      });
    }
  }

  return flags.sort((a, b) => b.severity - a.severity);
}

// ---------------------------------------------------------------------------
// Contribution inputs
// ---------------------------------------------------------------------------

/** Update schedules. Two per week, on days each member picks. */
export const updateSchedules = members.map((m) => ({
  memberId: m.id,
  weekdays: [1, 4], // Monday and Thursday by default
  updatesPerWeek: UPDATES_PER_WEEK_DEFAULT,
  dueTime: "23:59",
  pausedUntil: undefined as string | undefined,
}));

export function scheduleFor(memberId: string): UpdateSchedule {
  // From the store, not the seed array — a member invited through the app has a
  // schedule row there and none in the literals above.
  const found = live().updateSchedules.find((s) => s.memberId === memberId);
  if (found) return found;

  // Anyone created outside the invite flow — the bootstrap Co-Lead in migration
  // 0006, say — has no row yet. Return a sensible default rather than
  // undefined, or Settings renders nothing and they can never pick their days.
  return {
    memberId,
    weekdays: [2, 5],
    updatesPerWeek: UPDATES_PER_WEEK_DEFAULT,
    dueTime: "23:59",
  };
}

/**
 * The check-in a member currently owes.
 *
 * Was a single hardcoded object keyed to `CURRENT_USER_ID`, which in live mode
 * would have shown one person's draft to everybody.
 */
export function currentUpdateFor(memberId: string): ProgressUpdate {
  const mine = live().progressUpdates.filter((u) => u.memberId === memberId);

  const open = mine
    .filter((u) => u.status === "pending" || u.status === "late")
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt))[0];
  if (open) return open;

  const latest = [...mine].sort((a, b) => b.dueAt.localeCompare(a.dueAt))[0];
  if (latest) return latest;

  /*
    Nothing on record — a brand-new member, or a clean database.

    Synthesise a pending obligation so My Work renders and the composer has
    somewhere to write. But ONLY in session: outside a quarter this is the line
    that would invent a check-in obligation over winter break, for every member
    with no history, on a day the club has explicitly paused. The terms table
    exists to prevent exactly that, and it can't if the fallback ignores it.

    Out of session the obligation is `reviewed` rather than `pending`: it's a
    placeholder the UI can render, and nothing about it is owed.
  */
  const dueToday = inSession(today());

  return {
    id: `pending-${memberId}`,
    memberId,
    dueAt: `${today()}T23:59`,
    status: dueToday ? "pending" : "reviewed",
    entries: [],
    hoursThisPeriod: 0,
  };
}

/**
 * Assembles everything the contribution record needs for one member.
 *
 * `activeWeeks` counts in-session weeks only — finals and breaks are excluded,
 * so hours-per-week isn't diluted by three weeks of winter break when nobody was
 * expected to work.
 */
export function contributionInputsFor(
  memberId: string,
  activeWeeks = 10
): ContributionInputs {
  const mine = myDeliverables(memberId);
  const committed = live().projectMemberships.filter(
    (pm) => pm.memberId === memberId && pm.commitment === "committed"
  );

  const completedProjectIds = new Set(
    mine
      .filter((d) => d.status === "done")
      .map((d) => d.projectId)
      .filter((pid) => getProject(pid)?.phase === "complete")
  );

  const myUpdates = live().progressUpdates.filter((u) => u.memberId === memberId);
  const schedule = scheduleFor(memberId);

  return {
    activeWeeks,
    isPaused: !!schedule?.pausedUntil && schedule.pausedUntil > today(),
    deliverablesCompleted: mine.filter((d) => d.status === "done").length,
    deliverablesOpen: mine.filter((d) => d.status !== "done").length,
    deliverablesOverdue: mine.filter(isOverdue).length,
    projectsCompleted: completedProjectIds.size,
    // live(), not the seed array. Reading the seed here meant Hours/week sat
    // at 0.0 no matter how much anyone logged — the same bug Find Work had.
    hoursTotal: live()
      .workLogs.filter((w) => w.memberId === memberId)
      .reduce((sum, w) => sum + w.hours, 0),
    updatesDue: myUpdates.length,
    updatesOnTime: myUpdates.filter(
      (u) => u.status === "submitted" || u.status === "reviewed"
    ).length,
    updatesLate: myUpdates.filter((u) => u.status === "late").length,
    reRoleCount: live().projects.filter((p) => p.reIds.includes(memberId)).length,
    projectsCommitted: committed.length,
  };
}

/** How many projects an RE has actually put this member on. No cap. */
export function committedProjectCount(memberId: string): number {
  return live().projectMemberships.filter(
    (pm) => pm.memberId === memberId && pm.commitment === "committed"
  ).length;
}

/** Every project a member is on, with their role and responsibility. */
export function myProjects(memberId: string) {
  return live().projectMemberships
    .filter((pm) => pm.memberId === memberId)
    .map((pm) => ({
      membership: pm,
      project: getProject(pm.projectId)!,
    }))
    .filter((x) => x.project)
    .sort((a, b) => {
      // REs first — that's where accountability sits
      if (a.membership.role !== b.membership.role) {
        return a.membership.role === "re" ? -1 : 1;
      }
      return a.project.name.localeCompare(b.project.name);
    });
}

/**
 * Who to ask about this project. Primary RE first — that ordering comes from
 * `primaryReId`, not array position, so it's deterministic.
 */
export function projectREs(projectId: string): Member[] {
  const project = getProject(projectId);
  if (!project) return [];

  const found = project.reIds
    .map((id) => getMember(id))
    .filter((m): m is Member => m !== undefined);

  return found.sort((a, b) => {
    if (a.id === project.primaryReId) return -1;
    if (b.id === project.primaryReId) return 1;
    return a.fullName.localeCompare(b.fullName);
  });
}

/**
 * Which Division a project ultimately belongs to.
 *
 * A project's `teamId` may point at a sub-team or sub-sub-team, so this walks up
 * the org tree to the Division. Grouping by `teamId` directly would silently
 * hide any project owned by a sub-team — on the page whose entire job is making
 * work discoverable.
 */
export function divisionForProject(projectId: string): Team | undefined {
  const project = getProject(projectId);
  if (!project) return undefined;

  // Divisions attach at the top of the project tree, so start from the root
  let root = project;
  const seenProjects = new Set<string>([project.id]);
  while (root.parentId && !seenProjects.has(root.parentId)) {
    seenProjects.add(root.parentId);
    const parent = getProject(root.parentId);
    if (!parent) break;
    root = parent;
  }

  let team = root.teamId ? getTeam(root.teamId) : undefined;
  const seenTeams = new Set<string>();
  while (team && team.parentId && !seenTeams.has(team.id)) {
    seenTeams.add(team.id);
    const parent = getTeam(team.parentId);
    if (!parent) break;
    team = parent;
  }
  return team;
}

/**
 * A member's own work log, newest first, back as far as hours can be edited.
 *
 * Bounded by the backdating window on purpose: beyond it nothing can be deleted
 * anyway, so a longer list would be a wall of rows with no available action.
 * The point of showing it is correcting a mistake, not browsing a history.
 */
export function recentWorkLogs(memberId: string, days = 14) {
  const cutoff = new Date(`${today()}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - days);
  const from = cutoff.toISOString().slice(0, 10);

  return live()
    .workLogs.filter((w) => w.memberId === memberId && w.workDate >= from)
    .sort(
      (a, b) => b.workDate.localeCompare(a.workDate) || b.id.localeCompare(a.id)
    );
}

export function hoursOnProject(memberId: string, projectId: string) {
  return live().workLogs
    .filter((w) => w.memberId === memberId && w.projectId === projectId)
    .reduce((sum, w) => sum + w.hours, 0);
}

/** Most recent submitted entry a member wrote about a specific project. */
export function lastEntryForProject(memberId: string, projectId: string) {
  const candidates = progressUpdates
    .filter((u) => u.memberId === memberId && u.submittedAt)
    .flatMap((u) =>
      u.entries
        .filter((e) => e.projectId === projectId)
        .map((e) => ({ entry: e, submittedAt: u.submittedAt! }))
    )
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));

  return candidates[0];
}

/** All entries about a project, from anyone — the project's activity feed. */
/** Automatic announcements on a project, newest first. See `ProjectNotice`. */
export function projectNotices(projectId: string) {
  return live()
    .projectNotices.filter((n) => n.projectId === projectId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function projectUpdateFeed(projectId: string) {
  return live().progressUpdates
    .filter((u) => u.submittedAt)
    .flatMap((u) =>
      u.entries
        .filter((e) => e.projectId === projectId)
        .map((e) => ({
          entry: e,
          memberId: u.memberId,
          submittedAt: u.submittedAt!,
        }))
    )
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
}

/** Blockers across a member's projects — what a Lead most needs to see. */
/** Sections in display order. Manual, because the shop isn't alphabetical. */
export function trainingSections() {
  return [...live().trainingSections].sort((a, b) => a.sortOrder - b.sortOrder);
}

export function catalogueItemsFor(sectionId: string) {
  return live()
    .catalogueItems.filter((i) => i.sectionId === sectionId)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

export function certificationsFor(memberId: string) {
  return live().certifications.filter((c) => c.memberId === memberId);
}

export function helpRequestById(id: string) {
  return live().helpRequests.find((h) => h.id === id);
}

/** Every free-form ask, newest first. The board re-sorts by age. */
export function helpRequests() {
  return [...live().helpRequests].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt)
  );
}

export function openBlockers() {
  return live().progressUpdates
    .filter((u) => u.submittedAt)
    .flatMap((u) =>
      u.entries
        .filter((e) => e.blockers)
        .map((e) => ({ entry: e, memberId: u.memberId, status: u.status }))
    );
}

/**
 * Update compliance for the current window — powers the dashboard donut.
 *
 * `pending` means "due but not yet past its deadline", so it is deliberately
 * EXCLUDED from the denominator. Counting it would drag the figure down for
 * updates nobody is late on yet, making leadership see a problem that isn't
 * there.
 *
 * This definition becomes the `v_update_compliance` SQL view — get it right
 * here first.
 */
export function updateCompliance() {
  const all = live().progressUpdates;
  const onTime = all.filter(
    (u) => u.status === "submitted" || u.status === "reviewed"
  ).length;
  const late = all.filter((u) => u.status === "late").length;
  const missed = all.filter((u) => u.status === "missed").length;
  const pending = all.filter((u) => u.status === "pending").length;

  const resolved = onTime + late + missed;

  return {
    total: all.length,
    resolved,
    onTime,
    late,
    missed,
    pending,
    fraction: resolved > 0 ? onTime / resolved : 1,
  };
}

/** Reference "today" for the mock data. Replaced by `now()` in Phase 1. */
/**
 * Today's date, as YYYY-MM-DD.
 *
 * A FUNCTION, not a constant, and that matters now the app runs live. As a
 * module-level const it was evaluated once at import — frozen at whenever the
 * server booted — so hours backdating, escalation ages and compliance would all
 * have drifted a day at a time without anything looking broken.
 *
 * Demo mode keeps the fixed date so the sample data always tells the same story
 * and the tests stay deterministic.
 */
export function today(): string {
  if (isLiveMode()) return new Date().toISOString().slice(0, 10);
  return DEMO_TODAY;
}

/** The date the sample data is written around. */
export const DEMO_TODAY = "2026-08-06";

function daysBetween(a: string, b: string): number {
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return Math.abs(ms) / 86_400_000;
}

/** Hours logged in the trailing 7 days — matches the dashboard's label. */
export function hoursThisWeek(): number {
  return live().workLogs
    .filter((w) => daysBetween(w.workDate, today()) <= 7)
    .reduce((sum, w) => sum + w.hours, 0);
}

/** Hours a member logged on one project in the trailing 7 days. */
export function hoursOnProjectThisWeek(memberId: string, projectId: string) {
  return live().workLogs
    .filter(
      (w) =>
        w.memberId === memberId &&
        w.projectId === projectId &&
        daysBetween(w.workDate, today()) <= 7
    )
    .reduce((sum, w) => sum + w.hours, 0);
}

export function awaitingReview() {
  return live().progressUpdates.filter((u) => u.status === "submitted" || u.status === "late");
}

export function atRiskProjects() {
  return live().projects.filter((p) => p.health === "at_risk" || p.health === "blocked");
}
