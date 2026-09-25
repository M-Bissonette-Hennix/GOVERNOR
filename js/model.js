export const APP_VERSION = '0.1.2';
export const DB_VERSION = 1;

export const MODES = ['anchor','surge','build','maintain','dormant','restorative'];
export const DOSES = ['contact','maintenance','advance','surge'];
export const OP_STATES = ['down','anchoring','online','functional','engaged','deep','close'];

export const SEEDED_DOMAINS = [
  {
    id:'work', name:'Paid Work', mode:'anchor', frontier:'Current professional obligations',
    continuityDays:2, depthDays:4, ignition:'medium', immersion:'high', active:true,
    bridge:['Open the current work frontier and identify the single next deliverable.'],
    notes:'External obligation. Does not automatically count as Cyber Mastery.'
  },
  {
    id:'chess', name:'Chess', mode:'surge', frontier:'NC Open preparation',
    continuityDays:2, depthDays:4, ignition:'medium', immersion:'high', active:true,
    bridge:['Load one serious calculation position.','Review one recent error without an engine.','Reconstruct one Breyer position from memory.'],
    notes:'Frequent contact; serious depth should recur across the rolling window.'
  },
  {
    id:'cyber', name:'Cyber Mastery', mode:'build', frontier:'Offensive-security capability / TROUBLEDPOET field work',
    continuityDays:3, depthDays:5, ignition:'high', immersion:'high', active:true,
    bridge:['Open the current technical frontier and reconstruct exactly where work stopped.','Reproduce one known technique from memory.','Read the last TROUBLEDPOET state summary, then name the next falsifiable step.'],
    notes:'Deliberate skill development is distinct from paid work and project administration.'
  },
  {
    id:'physical', name:'Physical', mode:'build', frontier:'FOUNDATION / 28 re-entry and progression',
    continuityDays:2, depthDays:4, ignition:'high', immersion:'low', active:true,
    bridge:['Open FOUNDATION / 28 and execute the prescribed re-entry step.'],
    notes:'This governor schedules contact; FOUNDATION / 28 governs exercise execution.'
  },
  {
    id:'oom', name:'Office of Method', mode:'build', frontier:'Current research / publication front',
    continuityDays:5, depthDays:10, ignition:'high', immersion:'high', active:true,
    bridge:['Read the current research question.','Review one source or note at the active frontier.','Reopen the active paper and recover its unresolved question.'],
    notes:'Research/production should not be conflated with site administration.'
  },
  {
    id:'fiction', name:'Fiction', mode:'build', frontier:'Sangkkor / active fiction front',
    continuityDays:5, depthDays:9, ignition:'high', immersion:'very-high', active:true,
    bridge:['Read the final two pages of the current manuscript.','Read the current scene brief.','Reload the narrative state; write only if prose arrives naturally.'],
    notes:'Prefer fewer coherent immersions over fragmented token sessions.'
  },
  {
    id:'reading', name:'Reading', mode:'restorative', frontier:'Reading for restoration or deliberate study',
    continuityDays:7, depthDays:14, ignition:'low', immersion:'medium', active:true,
    bridge:['Read ten pages without turning it into a performance metric.'],
    notes:'Restorative reading does not have to compete for portfolio status.'
  }
];

export const DEFAULT_SETTINGS = {
  schemaVersion:1,
  version:APP_VERSION,
  firstRun:true,
  defaultWorkDays:[1,2,3,4,5],
  maxContinuityItems:2,
  contextSwitchLimit:3,
  quietNightStart:20,
  quietNightEnd:6,
  lastView:'now'
};

export const ANCHOR_ACTIONS = [
  {id:'upright', title:'Leave the bed.', detail:'The only objective is to become upright and out of the bed.', core:true,
   decompositions:['Sit upright.','Put both feet on the floor.','Stand up.','Leave the room.']},
  {id:'hydrate', title:'Drink something.', detail:'Get water or another ordinary non-alcoholic drink into reach and drink some.', core:true,
   decompositions:['Put a drink within reach.','Take three sips.']},
  {id:'meds', title:'Medication check.', detail:'Check whether your prescribed medication is due and follow the prescription directions. Do not improvise a dose.', core:true,
   decompositions:['Locate the prescription instructions.','If timing or a missed dose is unclear, check the label or contact your pharmacist/prescriber rather than guessing.']},
  {id:'food', title:'Eat something substantive.', detail:'The objective is provisioning, not dietary perfection.', core:true,
   decompositions:['Get one easy food item.','Eat the first few bites.']},
  {id:'hygiene', title:'Wash and change state.', detail:'Shower if feasible; otherwise wash and change clothes enough to mark a real state transition.', core:true,
   decompositions:['Go to the bathroom.','Wash your face and brush your teeth.','Change your shirt and basic clothes.']},
  {id:'light', title:'Change the environment.', detail:'During daytime, get daylight or move near it. At night, change rooms or lighting without treating the wake period as a new workday.', core:false,
   decompositions:['Open the blinds or curtains.','Move to a different room.']},
  {id:'move', title:'Move briefly.', detail:'Use a very small, physically appropriate movement step. This is not the full exercise program.', core:false,
   decompositions:['Stand and walk for two minutes.']},
  {id:'context', title:'Break isolation or change context.', detail:'If useful, contact someone or move to a setting with ordinary human presence. No performance conversation is required.', core:false,
   decompositions:['Send one simple message.','Move to a shared/public setting if appropriate.']}
];

export function freshDailyState(dateKey){
  return {
    dateKey, operatingState:null, wakeEpisodeIds:[], activeWakeEpisodeId:null,
    anchor:{index:0, decompositionIndex:null, completed:[], skipped:[]},
    envelope:{minutes:120, cognition:'normal', fixedWork:null},
    contract:null, currentBlockId:null, closed:false, note:'', updatedAt:Date.now()
  };
}
