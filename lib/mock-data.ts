/**
 * Mock data so the UI can be built and reviewed before Supabase exists.
 *
 * Everything here is fake but shaped exactly like the real schema
 * (docs/DATA_MODEL.md). When the database is wired up, these exports get
 * replaced by queries and the components shouldn't need to change.
 */

import type {
  ClubEvent,
  Member,
  Project,
  ProjectMembership,
  ProgressUpdate,
  Team,
  WorkLog,
} from "./types";

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
    globalRole: "member",
    status: "active",
    leadId: "m-dev",
    primaryTeamId: "team-composites",
    classYear: 2028,
    major: "Materials Science",
    joinedAt: "2026-06-02",
    skills: ["materials", "testing"],
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
  { projectId: "p-airframe-v2", memberId: "m-priya", role: "re", responsibility: "Overall airframe integration", joinedAt: "2026-04-01" },
  { projectId: "p-airframe-v2", memberId: "m-tyler", role: "re", responsibility: "Structural analysis", joinedAt: "2026-05-01" },
  { projectId: "p-airframe-v2", memberId: "m-sofia", role: "contributor", responsibility: "Composite fabrication", joinedAt: "2026-05-04" },
  { projectId: "p-wing-spar", memberId: "m-tyler", role: "re", responsibility: "Spar design and analysis", joinedAt: "2026-05-01" },
  { projectId: "p-wing-spar", memberId: "m-noah", role: "contributor", responsibility: "Material characterization", joinedAt: "2026-06-02" },
  { projectId: "p-layup", memberId: "m-sofia", role: "re", responsibility: "Process documentation", joinedAt: "2026-06-01" },
  { projectId: "p-layup", memberId: "m-noah", role: "contributor", responsibility: "Coupon testing", joinedAt: "2026-06-10" },
  { projectId: "p-load-test", memberId: "m-noah", role: "re", responsibility: "Test rig and instrumentation", joinedAt: "2026-07-15" },
  { projectId: "p-gps-denied", memberId: "m-lena", role: "re", responsibility: "Autonomy architecture", joinedAt: "2026-04-15" },
  { projectId: "p-gps-denied", memberId: "m-amara", role: "re", responsibility: "Perception stack", joinedAt: "2026-04-20" },
  { projectId: "p-vio", memberId: "m-amara", role: "re", responsibility: "VIO implementation", joinedAt: "2026-05-01" },
  { projectId: "p-vio", memberId: "m-omar", role: "contributor", responsibility: "Dataset collection", joinedAt: "2026-05-20" },
  { projectId: "p-sim", memberId: "m-omar", role: "re", responsibility: "Simulation environment", joinedAt: "2026-06-01" },
  { projectId: "p-avionics-bringup", memberId: "m-marcus", role: "re", responsibility: "Avionics integration", joinedAt: "2026-04-20" },
  { projectId: "p-avionics-bringup", memberId: "m-kenji", role: "re", responsibility: "Electronics design", joinedAt: "2026-04-25" },
  { projectId: "p-power", memberId: "m-kenji", role: "re", responsibility: "PDB schematic and layout", joinedAt: "2026-06-15" },
  { projectId: "p-propulsion-test", memberId: "m-hana", role: "re", responsibility: "Test stand and data", joinedAt: "2026-05-20" },
  { projectId: "p-outreach", memberId: "m-james", role: "re", responsibility: "Workshop program", joinedAt: "2026-08-01" },
  { projectId: "p-outreach", memberId: "m-grace", role: "re", responsibility: "Curriculum and logistics", joinedAt: "2026-08-01" },
  { projectId: "p-skydelta-concept", memberId: "m-priya", role: "re", responsibility: "Trade study lead", joinedAt: "2026-07-01" },
];

// ---------------------------------------------------------------------------
// Updates — 3x per week cadence
// ---------------------------------------------------------------------------

export const progressUpdates: ProgressUpdate[] = [
  { id: "u-1", memberId: "m-sofia", dueAt: "2026-08-05T23:59", submittedAt: "2026-08-05T21:14", status: "submitted", progress: "Finished three coupon layups, two came out within spec.", blockers: "Vacuum pump seal is leaking.", nextSteps: "Replace seal, run remaining coupons.", projectIds: ["p-layup"], hoursThisPeriod: 6.5 },
  { id: "u-2", memberId: "m-tyler", dueAt: "2026-08-05T23:59", submittedAt: "2026-08-06T08:30", status: "late", progress: "Spar FEA converged, mass down 14%.", blockers: "Need the 18% target reviewed — may not be reachable without changing layup.", nextSteps: "Bring options to design review.", projectIds: ["p-wing-spar", "p-airframe-v2"], hoursThisPeriod: 9 },
  { id: "u-3", memberId: "m-omar", dueAt: "2026-08-05T23:59", status: "missed", progress: "", projectIds: ["p-sim"], hoursThisPeriod: 1.5 },
  { id: "u-4", memberId: "m-kenji", dueAt: "2026-08-05T23:59", submittedAt: "2026-08-05T18:02", status: "reviewed", progress: "PDB schematic complete, routing 60% done.", nextSteps: "Finish routing, send for review before fab.", projectIds: ["p-power"], hoursThisPeriod: 7 },
  { id: "u-5", memberId: "m-amara", dueAt: "2026-08-05T23:59", submittedAt: "2026-08-05T22:40", status: "submitted", progress: "VIO holding under 30cm drift over 50m indoor runs.", nextSteps: "Outdoor testing next week.", projectIds: ["p-vio"], hoursThisPeriod: 8.5 },
  { id: "u-6", memberId: "m-noah", dueAt: "2026-08-05T23:59", status: "pending", progress: "", projectIds: ["p-load-test"], hoursThisPeriod: 4 },
  { id: "u-7", memberId: "m-hana", dueAt: "2026-08-05T23:59", submittedAt: "2026-08-05T20:10", status: "submitted", progress: "Test stand frame welded, load cell mounted.", blockers: "Waiting on calibration weights.", nextSteps: "Calibrate and run first motor.", projectIds: ["p-propulsion-test"], hoursThisPeriod: 5.5 },
];

// ---------------------------------------------------------------------------
// Hours
// ---------------------------------------------------------------------------

export const workLogs: WorkLog[] = [
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
  return members.find((m) => m.id === id);
}

export function getProject(id: string) {
  return projects.find((p) => p.id === id);
}

export function directREs(projectId: string) {
  return getProject(projectId)?.reIds ?? [];
}

export function divisions() {
  return teams.filter((t) => t.parentId === null);
}

export function childTeams(parentId: string) {
  return teams.filter((t) => t.parentId === parentId);
}

export function childProjects(parentId: string | null) {
  return projects.filter((p) => p.parentId === parentId);
}

export function projectMembers(projectId: string) {
  return projectMemberships
    .filter((pm) => pm.projectId === projectId)
    .map((pm) => ({ ...pm, member: getMember(pm.memberId) }));
}

export function memberProjects(memberId: string) {
  return projectMemberships
    .filter((pm) => pm.memberId === memberId)
    .map((pm) => ({ ...pm, project: getProject(pm.projectId) }));
}

export function activeMembers() {
  return members.filter((m) => m.status === "active");
}

/** Update compliance for the current window — powers the dashboard donut. */
export function updateCompliance() {
  const total = progressUpdates.length;
  const onTime = progressUpdates.filter(
    (u) => u.status === "submitted" || u.status === "reviewed"
  ).length;
  const late = progressUpdates.filter((u) => u.status === "late").length;
  const missed = progressUpdates.filter((u) => u.status === "missed").length;
  const pending = progressUpdates.filter((u) => u.status === "pending").length;

  return {
    total,
    onTime,
    late,
    missed,
    pending,
    fraction: total > 0 ? onTime / total : 0,
  };
}

export function hoursThisWeek() {
  return workLogs.reduce((sum, w) => sum + w.hours, 0);
}

export function awaitingReview() {
  return progressUpdates.filter((u) => u.status === "submitted" || u.status === "late");
}

export function atRiskProjects() {
  return projects.filter((p) => p.health === "at_risk" || p.health === "blocked");
}
