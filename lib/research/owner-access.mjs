/** @param {string|null|undefined} userId @param {string|undefined} configuredOwners */
export function canReadOwnerResearch(userId,configuredOwners){
 if(typeof userId!=='string'||!userId.trim())return false
 return (configuredOwners??'').split(',').map(s=>s.trim()).filter(Boolean).includes(userId)
}
