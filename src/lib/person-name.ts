// How a person is shown: their alias (stage name) if they have one, otherwise first name and surname.
export function personName(p: { firstName: string; surname: string; alias?: string | null }) {
  return p.alias?.trim() || `${p.firstName} ${p.surname}`.trim();
}
