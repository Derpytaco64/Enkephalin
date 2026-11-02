/**
 * Builds the therapeutic categories you study by, as tags of kind `system`.
 *
 * The FDA class is too fine to study by: 119 values over 216 drugs, 80 of them
 * naming a single drug, and no "Anticonvulsants" at all -- the nine
 * anticonvulsants in the sheet scatter across Mood Stabilizer, Anti-epileptic
 * Agent and five that have no class. So categories group the class axis rather
 * than replacing it, and the class stays what it was: colour coding, the browse
 * filter, and the axis same-class distractors are drawn along.
 *
 * Categories are tags, which buys three things: the study scope already filters
 * on tags, the browse rail already groups them by kind, and `drug_tags` is
 * many-to-many -- so carbamazepine can be an anticonvulsant *and* a mood
 * stabiliser, which is true and which a single class column cannot say.
 *
 * This is a curated judgement, not a lookup, so it is one table to read and
 * argue with. Re-running replaces only the `system` tags: drug lists and any
 * other tag kind are left alone.
 *
 *   node --experimental-strip-types scripts/seed-categories.ts
 */
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { drugTags, drugs, tags } from '../db/schema.ts';

/**
 * FDA class -> the categories it belongs to. A class may map to several, and
 * several classes may map to one: that is the whole point of the grouping.
 */
const BY_CLASS: Record<string, string[]> = {
  // ---- cardiovascular
  'Angiotensin Converting Enzyme Inhibitor': ['ACE inhibitors', 'Antihypertensives'],
  'Angiotensin 2 Receptor Blocker': ['Angiotensin receptor blockers', 'Antihypertensives'],
  'beta-Adrenergic Blocker': ['Beta blockers', 'Antihypertensives'],
  'Calcium Channel Blocker': ['Calcium channel blockers', 'Antihypertensives'],
  'Central alpha-2 Adrenergic Agonist': ['Central alpha-2 agonists', 'Antihypertensives'],
  'alpha-Adrenergic Blocker': ['Alpha blockers', 'Antihypertensives'],
  'Thiazide Diuretic': ['Diuretics', 'Antihypertensives'],
  'Thiazide-like Diuretic': ['Diuretics', 'Antihypertensives'],
  'Loop Diuretic': ['Diuretics'],
  'Potassium-sparing Diuretic': ['Diuretics'],
  'Aldosterone Antagonist': ['Diuretics'],
  'HMG-CoA Reductase Inhibitor': ['Statins', 'Lipid-lowering agents'],
  'Dietary Cholesterol Absorption Inhibitor': ['Lipid-lowering agents'],
  'Bile Acid Sequestrant': ['Lipid-lowering agents'],
  'PCSK9 Inhibitor': ['Lipid-lowering agents'],
  // Fenofibrate by this class; pioglitazone shares it and is overridden below.
  'Peroxisome Proliferator-activated Receptor alpha Agonist': ['Lipid-lowering agents'],
  'Vitamin K Antagonist': ['Anticoagulants'],
  'Factor Xa Inhibitor': ['Anticoagulants'],
  'Low Molecular Weight Heparin': ['Anticoagulants'],
  'Anti-coagulant': ['Anticoagulants'],
  'Platelet Aggregation Inhibitor': ['Antiplatelets'],
  'P2Y12 Platelet Inhibitor': ['Antiplatelets'],
  Antiarrhythmic: ['Antiarrhythmics'],
  'Cardiac Glycoside': ['Antiarrhythmics'],
  'Nitrate Vasodilator': ['Vasodilators'],
  'Prostacycline Vasodilator': ['Vasodilators'],
  Catecholamine: ['Vasopressors and inotropes'],
  'alpha-1 Adrenergic Agonist': ['Vasopressors and inotropes'],
  'Norepinephrine Releasing Agent': ['Vasopressors and inotropes'],

  // ---- central nervous system
  'Serotonin Reuptake Inhibitor': ['Antidepressants'],
  'Serotonin and Norepinephrine Reuptake Inhibitor': ['Antidepressants'],
  'Tricyclic Antidepressant': ['Antidepressants'],
  Aminoketone: ['Antidepressants'],
  'Atypical Antipsychotic': ['Antipsychotics'],
  Benzodiazepine: ['Benzodiazepines', 'Anxiolytics and sedative-hypnotics'],
  'gamma-Aminobutyric Acid A Receptor Positive Modulator': ['Anxiolytics and sedative-hypnotics'],
  Barbiturate: ['Anxiolytics and sedative-hypnotics'],
  'Anti-epileptic Agent': ['Anticonvulsants'],
  // Carbamazepine, which is both.
  'Mood Stabilizer': ['Anticonvulsants', 'Mood stabilizers'],
  'Central Nervous System Stimulant': ['ADHD agents'],
  'Norepinephrine Reuptake Inhibitor': ['ADHD agents'],
  'Sympathomimetic Amine Anorectic': ['Weight management agents'],
  'Opioid Agonist': ['Opioids'],
  'Opioid Antagonist': ['Opioids', 'Antidotes'],
  'Nonsteroidal Anti-inflammatory Drug': ['NSAIDs'],
  // Ketorolac.
  'Cyclooxygenase Inhibitor': ['NSAIDs'],
  'Muscle Relaxant': ['Muscle relaxants'],
  'gamma-Aminobutyric Acid-ergic Agonist': ['Muscle relaxants'],
  'Nonergot Dopamine Agonist': ['Antiparkinson agents'],
  'Aromatic Amino Acid': ['Antiparkinson agents'],
  'Cholinesterase Inhibitor': ['Dementia agents'],
  'N-methyl-D-aspartate Receptor Antagonist': ['Dementia agents'],
  'Serotonin-1b and Serotonin-1d Receptor Agonist': ['Migraine agents'],
  'Calcitonin Gene-related Peptide Receptor Antagonist': ['Migraine agents'],
  'General Anesthetic': ['Anesthetics and neuromuscular blockers'],
  'Nondepolarizing Neuromuscular Blocker': ['Anesthetics and neuromuscular blockers'],
  'Depolarizing Neuromuscular Blocker': ['Anesthetics and neuromuscular blockers'],
  'Non-narcotic Antitussive': ['Cough and cold agents'],

  // ---- anti-infectives
  'Penicillin-class Antibacterial': ['Penicillins', 'Antibacterials'],
  'Cephalosporin Antibacterial': ['Cephalosporins', 'Antibacterials'],
  'Fluoroquinolone Antibacterial': ['Fluoroquinolones', 'Antibacterials'],
  'Quinolone Antimicrobial': ['Fluoroquinolones', 'Antibacterials'],
  'Macrolide Antimicrobial': ['Macrolides', 'Antibacterials'],
  'Tetracycline-class Drug': ['Tetracyclines', 'Antibacterials'],
  'Sulfonamide Antimicrobial': ['Antibacterials'],
  'Glycopeptide Antibacterial': ['Antibacterials'],
  'Lincosamide Antibacterial': ['Antibacterials'],
  'Oxazolidinone Antibacterial': ['Antibacterials'],
  'Penem Antibacterial': ['Antibacterials'],
  'Nitrofuran Antibacterial': ['Antibacterials'],
  'Nitroimidazole Antimicrobial': ['Antibacterials'],
  'RNA Synthetase Inhibitor Antibacterial': ['Antibacterials'],
  'Allylamine Antifungal': ['Antifungals'],
  'Azole Antifungal': ['Antifungals'],
  'Echinocandin Antifungal': ['Antifungals'],
  'Polyene Antifungal': ['Antifungals'],
  'Herpes Simplex Virus Nucleoside Analog DNA Polymerase Inhibitor': ['Antivirals'],
  Antimalarial: ['Antimalarials'],

  // ---- endocrine
  'Insulin Analog': ['Insulins', 'Antidiabetics'],
  Biguanide: ['Antidiabetics'],
  Sulfonylurea: ['Antidiabetics'],
  'Dipeptidyl Peptidase 4 Inhibitor': ['Antidiabetics'],
  'Sodium-Glucose Cotransporter 2 Inhibitor': ['Antidiabetics'],
  'GLP-1 Receptor Agonist': ['Antidiabetics'],
  'l-Thyroxine': ['Thyroid agents'],
  Corticosteroid: ['Corticosteroids'],
  Estrogen: ['Sex hormones'],
  Progesterone: ['Sex hormones'],
  Androgen: ['Sex hormones'],
  // The two oral contraceptives.
  Progestin: ['Sex hormones', 'Contraceptives'],
  'Estrogen Agonist/Antagonist': ['Sex hormones', 'Antineoplastics'],
  'Aromatase Inhibitor': ['Antineoplastics'],
  'Folate Analog Metabolic Inhibitor': ['Antineoplastics'],
  '5-alpha Reductase Inhibitor': ['Urologic agents'],

  // ---- gastrointestinal
  'Proton Pump Inhibitor': ['Proton pump inhibitors', 'Gastrointestinal agents'],
  'Histamine-2 Receptor Antagonist': ['H2 blockers', 'Gastrointestinal agents'],
  'Serotonin-3 Receptor Antagonist': ['Antiemetics'],
  'Osmotic Laxative': ['Laxatives', 'Gastrointestinal agents'],
  'Guanylate Cyclase-C Agonist': ['Laxatives', 'Gastrointestinal agents'],
  // Sucralfate, ursodiol, dicyclomine -- all GI, none a bronchodilator.
  'Aluminum Complex': ['Gastrointestinal agents'],
  'Bile Acid': ['Gastrointestinal agents'],
  Anticholinergic: ['Gastrointestinal agents'],

  // ---- respiratory and allergy
  'beta2-Adrenergic Agonist': ['Bronchodilators', 'Asthma and COPD agents'],
  'beta-Adrenergic Agonist': ['Bronchodilators', 'Asthma and COPD agents'],
  'Leukotriene Receptor Antagonist': ['Asthma and COPD agents'],
  Antihistamine: ['Antihistamines'],
  'Histamine-1 Receptor Antagonist': ['Antihistamines'],

  // ---- genitourinary
  'Cholinergic Muscarinic Antagonist': ['Urologic agents'],
  'beta3-Adrenergic Agonist': ['Urologic agents'],
  'Phosphodiesterase 5 Inhibitor': ['Urologic agents'],
  Oxytocic: ['Obstetric agents'],

  // ---- everything else
  'Xanthine Oxidase Inhibitor': ['Gout agents'],
  Bisphosphonate: ['Bone agents'],
  'Calcineurin Inhibitor Immunosuppressant': ['Immunosuppressants'],
  'Vitamin B12': ['Vitamins and supplements'],
  'Parenteral Iron Replacement': ['Vitamins and supplements'],
  Antidote: ['Antidotes'],
  // Brimonidine, latanoprost, bimatoprost -- eye drops, not vasopressors.
  'alpha-Adrenergic Agonist': ['Ophthalmics'],
  'Prostaglandin Analog': ['Ophthalmics'],
};

/**
 * Per-drug, where the class is the wrong unit. Two reasons only: the drug has
 * no class at all (the twenty *Uncategorized*, placed from the VA class the
 * importer captured), or it shares a class with a drug of a different kind.
 *
 * These replace the class mapping rather than adding to it.
 */
const BY_DRUG: Record<string, string[]> = {
  // Shares "Peroxisome Proliferator-activated Receptor alpha Agonist" with
  // fenofibrate, but pioglitazone is a thiazolidinedione for diabetes.
  Pioglitazone: ['Antidiabetics'],

  // A mechanism class and a therapeutic category part company here: each of
  // these is taught somewhere other than where its class would file it.
  // Carvedilol blocks alpha-1 but is a beta blocker for heart failure;
  // sotalol's class III action does not stop it being a beta blocker.
  Carvedilol: ['Beta blockers', 'Antihypertensives'],
  Sotalol: ['Beta blockers', 'Antiarrhythmics'],
  // Uroselective alpha-1A: a BPH drug, not a blood pressure drug.
  Tamsulosin: ['Alpha blockers', 'Urologic agents'],
  // Central alpha-2 agonists, none of them used for blood pressure:
  // dexmedetomidine sedates in intensive care, tizanidine relaxes muscle, and
  // the extended-release forms are the ADHD products.
  Dexmedetomidine: ['Anxiolytics and sedative-hypnotics'],
  Tizanidine: ['Muscle relaxants'],
  'Guanfacine ER': ['ADHD agents'],
  'Clonidine ER': ['Central alpha-2 agonists', 'ADHD agents'],

  // Inhaled corticosteroids are asthma and COPD drugs; the combinations carry
  // a bronchodilator too. The systemic and topical steroids stay where they
  // are.
  Budesonide: ['Corticosteroids', 'Asthma and COPD agents'],
  'Budesonide/ Formoterol': ['Corticosteroids', 'Asthma and COPD agents', 'Bronchodilators'],
  'Fluticasone/ Salmeterol': ['Corticosteroids', 'Asthma and COPD agents', 'Bronchodilators'],
  'Fluticasone furoate/Vilanterol': ['Corticosteroids', 'Asthma and COPD agents', 'Bronchodilators'],
  'Fluticasone furoate/ Umeclidinium bromide/ Vilanterol':
    ['Corticosteroids', 'Asthma and COPD agents', 'Bronchodilators'],
  'Prednisolone Acetate (Ophthalmic)': ['Corticosteroids', 'Ophthalmics'],
  // Also an SSRI by class, but prescribed here for sleep.
  Trazodone: ['Antidepressants', 'Anxiolytics and sedative-hypnotics'],

  // The twenty with no FDA class.
  Alteplase: ['Thrombolytics'],
  Buspirone: ['Anxiolytics and sedative-hypnotics'],
  Chlorhexidine: ['Antiseptics'],
  'Divalproex sodium': ['Anticonvulsants', 'Mood stabilizers'],
  Eszopiclone: ['Anxiolytics and sedative-hypnotics'],
  'Folic acid': ['Vitamins and supplements'],
  'Fremanezumab-vfrm': ['Migraine agents'],
  Gabapentin: ['Anticonvulsants'],
  'Icosapent ethyl': ['Lipid-lowering agents'],
  Levetiracetam: ['Anticonvulsants'],
  Lithium: ['Mood stabilizers'],
  Methenamine: ['Antibacterials', 'Urologic agents'],
  Mirtazapine: ['Antidepressants'],
  'Omega-3-Acid Ethyl Esters': ['Lipid-lowering agents'],
  'Phytonadione Vitamin K': ['Vitamins and supplements', 'Antidotes'],
  'Potassium chloride': ['Vitamins and supplements'],
  // VA files pregabalin under CNS rather than anticonvulsants; it belongs with
  // gabapentin, which is where a course teaches it.
  Pregabalin: ['Anticonvulsants'],
  Topiramate: ['Anticonvulsants'],
  'Vilazodone Hydrochloride': ['Antidepressants'],
  Vortioxetine: ['Antidepressants'],
};

const slug = (label: string) =>
  label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const rows = await db
  .select({ id: drugs.id, generic: drugs.genericName, drugClass: drugs.drugClass })
  .from(drugs);

// Every category any drug lands in, created once.
const wanted = new Map<string, string>();
const assignments = new Map<string, string[]>();
const uncategorized: string[] = [];

for (const drug of rows) {
  const labels = BY_DRUG[drug.generic] ?? BY_CLASS[drug.drugClass ?? ''] ?? [];
  if (labels.length === 0) {
    uncategorized.push(`${drug.generic} (${drug.drugClass ?? 'no class'})`);
    continue;
  }
  assignments.set(drug.id, labels);
  for (const label of labels) wanted.set(slug(label), label);
}

const existing = await db.select({ id: tags.id, slug: tags.slug }).from(tags);
const tagIds = new Map(existing.map((tag) => [tag.slug, tag.id]));

for (const [tagSlug, label] of [...wanted].sort((a, b) => a[1].localeCompare(b[1]))) {
  if (tagIds.has(tagSlug)) continue;
  const [created] = await db
    .insert(tags)
    .values({ slug: tagSlug, label, kind: 'system', sortOrder: 100 })
    .returning({ id: tags.id });
  tagIds.set(tagSlug, created.id);
}

// Only the system tags are rebuilt. A drug list is a different kind of fact
// and is not this script's business.
const systemTags = await db.select({ id: tags.id }).from(tags).where(eq(tags.kind, 'system'));
if (systemTags.length > 0) {
  await db.delete(drugTags).where(inArray(drugTags.tagId, systemTags.map((tag) => tag.id)));
}

let links = 0;
for (const [drugId, labels] of assignments) {
  for (const label of labels) {
    await db
      .insert(drugTags)
      .values({ drugId, tagId: tagIds.get(slug(label))! })
      .onConflictDoNothing();
    links += 1;
  }
}

console.log(`categories: ${wanted.size} created or reused`);
console.log(`links:      ${links} across ${assignments.size} of ${rows.length} drugs`);

const sizes = await db
  .select({ label: tags.label, drugId: drugTags.drugId })
  .from(tags)
  .innerJoin(drugTags, eq(drugTags.tagId, tags.id))
  .where(eq(tags.kind, 'system'));
const counts = new Map<string, number>();
for (const row of sizes) counts.set(row.label, (counts.get(row.label) ?? 0) + 1);

console.log('\ncategory sizes:');
for (const [label, n] of [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
  console.log(`  ${String(n).padStart(3)}  ${label}`);
}

if (uncategorized.length > 0) {
  console.log(`\nno category (${uncategorized.length}):`);
  for (const name of uncategorized) console.log(`  ${name}`);
}

process.exit(0);
