export function validateJsonSchema(schema, value) {
  const errors = [];
  visit(schema, value, '$', errors);
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

function visit(schema, value, instancePath, errors) {
  if (!schema || typeof schema !== 'object') return;
  if (schema.const !== undefined && !same(value, schema.const)) push(errors, instancePath, 'const');
  if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => same(value, candidate))) push(errors, instancePath, 'enum');

  if (schema.type !== undefined && !matchesType(value, schema.type)) {
    push(errors, instancePath, 'type');
    return;
  }

  if (schema.not && probe(schema.not, value)) push(errors, instancePath, 'not');
  if (Array.isArray(schema.allOf)) schema.allOf.forEach((child) => visit(child, value, instancePath, errors));
  if (Array.isArray(schema.oneOf)) {
    const matches = schema.oneOf.filter((child) => probe(child, value)).length;
    if (matches !== 1) push(errors, instancePath, 'oneOf');
  }
  if (schema.if && probe(schema.if, value) && schema.then) visit(schema.then, value, instancePath, errors);

  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) push(errors, instancePath, 'minLength');
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) push(errors, instancePath, 'pattern');
    if (schema.format === 'date-time' && Number.isNaN(Date.parse(value))) push(errors, instancePath, 'format');
  }

  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) push(errors, instancePath, 'minimum');
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) push(errors, instancePath, 'exclusiveMinimum');
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) push(errors, instancePath, 'minItems');
    if (schema.maxItems !== undefined && value.length > schema.maxItems) push(errors, instancePath, 'maxItems');
    if (schema.uniqueItems && new Set(value.map((item) => JSON.stringify(item))).size !== value.length) push(errors, instancePath, 'uniqueItems');
    if (schema.contains && !value.some((item) => probe(schema.contains, item))) push(errors, instancePath, 'contains');
    if (schema.items) value.forEach((item, index) => visit(schema.items, item, `${instancePath}[${index}]`, errors));
    if (typeof schema['x-tcis-uniqueBy'] === 'string') {
      const field = schema['x-tcis-uniqueBy'];
      const seen = new Set();
      for (const item of value) {
        const key = isObject(item) ? item[field] : undefined;
        if (key !== undefined && seen.has(key)) push(errors, instancePath, 'x-tcis-uniqueBy');
        seen.add(key);
      }
    }
  }

  if (isObject(value)) {
    if (Array.isArray(schema.required)) {
      schema.required.forEach((key) => { if (!Object.hasOwn(value, key)) push(errors, `${instancePath}.${key}`, 'required'); });
    }
    if (schema.properties) {
      for (const [key, child] of Object.entries(schema.properties)) {
        if (Object.hasOwn(value, key)) visit(child, value[key], `${instancePath}.${key}`, errors);
      }
    }
    if (schema.additionalProperties === false && schema.properties) {
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(schema.properties, key)) push(errors, `${instancePath}.${key}`, 'additionalProperties');
      }
    }
    if (Array.isArray(schema['x-tcis-distinctFields'])) {
      for (const fields of schema['x-tcis-distinctFields']) {
        const present = fields.filter((field) => Object.hasOwn(value, field));
        if (present.length === fields.length && new Set(fields.map((field) => JSON.stringify(value[field]))).size !== fields.length) {
          push(errors, instancePath, 'x-tcis-distinctFields');
        }
      }
    }
    if (schema['x-tcis-timelineIntegrity'] === true) validateTimelineIntegrity(value, instancePath, errors);
    if (schema['x-tcis-lockSignoffs'] === true) validateLockSignoffs(value, instancePath, errors);
  }
}

function validateTimelineIntegrity(value, instancePath, errors) {
  if (!Number.isFinite(value.duration_seconds) || !Array.isArray(value.tracks)) return;
  const clipIds = new Set();
  for (const [trackIndex, track] of value.tracks.entries()) {
    if (!isObject(track) || !Array.isArray(track.clips)) continue;
    const intervals = [];
    for (const [clipIndex, clip] of track.clips.entries()) {
      if (!isObject(clip)) continue;
      const clipPath = `${instancePath}.tracks[${trackIndex}].clips[${clipIndex}]`;
      if (track.kind === 'VIDEO' && (!nonEmpty(clip.shot_id) || !nonEmpty(clip.take_id))) push(errors, clipPath, 'x-tcis-videoLineage');
      if (Number.isFinite(clip.start_seconds) && Number.isFinite(clip.duration_seconds)) {
        const end = clip.start_seconds + clip.duration_seconds;
        if (end > value.duration_seconds + Number.EPSILON) push(errors, clipPath, 'x-tcis-clipWithinTimeline');
        intervals.push({ start: clip.start_seconds, end });
      }
      if (nonEmpty(clip.clip_id)) {
        if (clipIds.has(clip.clip_id)) push(errors, clipPath, 'x-tcis-uniqueClipId');
        clipIds.add(clip.clip_id);
      }
    }
    intervals.sort((left, right) => left.start - right.start || left.end - right.end);
    for (let index = 1; index < intervals.length; index += 1) {
      if (intervals[index].start < intervals[index - 1].end - Number.EPSILON) push(errors, `${instancePath}.tracks[${trackIndex}]`, 'x-tcis-nonOverlappingClips');
    }
  }
}

function validateLockSignoffs(value, instancePath, errors) {
  if (!Array.isArray(value.signoffs) || typeof value.stage !== 'string') return;
  const byType = new Map(value.signoffs.filter(isObject).map((signoff) => [signoff.type, signoff.status]));
  const stageOrder = [
    'P0_BRIEF_ALIGNMENT', 'P1_DIAGNOSIS', 'P2_COMMUNICATIONS_STRATEGY', 'P3_CREATIVE_BRIEF', 'P4_CREATIVE_ROUTES',
    'P5_CORE_CREATIVE_DECISION', 'P6_TVC_EXPRESSION', 'P7_SCRIPT_AGENCY_BOARD', 'P8_VISUAL_PREDEVELOPMENT',
    'P9_PRODUCTION_PITCH', 'P10_DIRECTOR_TREATMENT_AWARD', 'P11_PREPRODUCTION_PPM', 'P12_PRODUCTION_SELECTS',
    'P13_OFFLINE_LOCK', 'P14_FINAL_RELEASE',
  ];
  const required = { CLIENT_DECISION: ['APPROVED'] };
  const atLeast = (stage) => stageOrder.indexOf(value.stage) >= stageOrder.indexOf(stage);
  if (atLeast('P3_CREATIVE_BRIEF')) required.STRATEGY = ['APPROVED', 'NOT_APPLICABLE'];
  if (atLeast('P4_CREATIVE_ROUTES')) required.CREATIVE = ['APPROVED'];
  if (atLeast('P7_SCRIPT_AGENCY_BOARD')) required.CLAIMS = ['CLEARED', 'NOT_APPLICABLE'];
  if (atLeast('P11_PREPRODUCTION_PPM')) {
    required.RIGHTS = ['CLEARED', 'NOT_APPLICABLE'];
    required.PRODUCTION = ['APPROVED'];
  }
  if (atLeast('P14_FINAL_RELEASE')) {
    required.TECHNICAL_QC = ['APPROVED'];
    required.RELEASE = ['APPROVED'];
  }
  for (const [type, allowed] of Object.entries(required)) {
    if (!allowed.includes(byType.get(type))) push(errors, `${instancePath}.signoffs`, 'x-tcis-lockSignoffs');
  }
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function probe(schema, value) {
  const errors = [];
  visit(schema, value, '$', errors);
  return errors.length === 0;
}

function matchesType(value, declared) {
  const types = Array.isArray(declared) ? declared : [declared];
  return types.some((type) => {
    if (type === 'null') return value === null;
    if (type === 'object') return isObject(value);
    if (type === 'array') return Array.isArray(value);
    if (type === 'integer') return Number.isInteger(value);
    if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
    return typeof value === type;
  });
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function push(errors, path, keyword) {
  errors.push(Object.freeze({ path, keyword }));
}
