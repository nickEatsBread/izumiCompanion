/** Original bundled vector portraits; no remote requests or licensed character artwork. */
export const PROFILE_AVATARS = ['fox', 'cat', 'bear', 'owl', 'rabbit', 'robot', 'orbit', 'wave'] as const
export type ProfileAvatarId = typeof PROFILE_AVATARS[number]
export function validAvatar(value: unknown): ProfileAvatarId {
  return PROFILE_AVATARS.includes(value as ProfileAvatarId) ? value as ProfileAvatarId : 'fox'
}
export function profileAvatarUrl(avatar: unknown, color: string): string {
  const backdrop = /^#[0-9a-f]{6}$/i.test(color) ? color : '#457b9d'
  const eyes = '<ellipse cx="43" cy="59" rx="3.5" ry="5" fill="#19242c"/><ellipse cx="77" cy="59" rx="3.5" ry="5" fill="#19242c"/>'
  const smile = '<path d="M51 78q9 9 18 0" fill="none" stroke="#19242c" stroke-width="3" stroke-linecap="round"/>'
  const faces: Record<ProfileAvatarId, string> = {
    fox: '<path d="M24 21l28 20h16l28-20-6 54-30 24-30-24z" fill="#eaa15a"/><path d="M30 62l30 9 30-9-7 22-23 15-23-15z" fill="#fff0d5"/>' + eyes + '<path d="M54 71h12l-6 7z" fill="#19242c"/>',
    cat: '<path d="M26 26l25 14h18l25-14-3 43q-2 27-31 27T29 69z" fill="#dfd6be"/>' + eyes + '<path d="M57 70h6l-3 4m-26-1-17-4m18 11-17 3m68-10 17-4m-18 11 17 3" stroke="#19242c" stroke-width="2.5" stroke-linecap="round"/>',
    bear: '<circle cx="32" cy="35" r="16" fill="#c69168"/><circle cx="88" cy="35" r="16" fill="#c69168"/><rect x="25" y="32" width="70" height="65" rx="31" fill="#dba57b"/><ellipse cx="60" cy="77" rx="20" ry="16" fill="#ffebce"/>' + eyes + '<ellipse cx="60" cy="72" rx="7" ry="5" fill="#19242c"/>' + smile,
    owl: '<path d="M25 28l19 9h32l19-9v40q0 34-35 34T25 68z" fill="#c8b697"/><circle cx="43" cy="59" r="19" fill="#fff0d5"/><circle cx="77" cy="59" r="19" fill="#fff0d5"/>' + eyes + '<path d="M54 76l6 11 6-11" fill="#e79c42"/>',
    rabbit: '<ellipse cx="43" cy="30" rx="12" ry="27" fill="#efe5da"/><ellipse cx="77" cy="30" rx="12" ry="27" fill="#efe5da"/><ellipse cx="43" cy="28" rx="5" ry="19" fill="#dfa6a6"/><ellipse cx="77" cy="28" rx="5" ry="19" fill="#dfa6a6"/><ellipse cx="60" cy="70" rx="36" ry="31" fill="#efe5da"/>' + eyes + '<path d="M56 73h8l-4 5z" fill="#d7838a"/>' + smile,
    robot: '<path d="M60 18v15" stroke="#f9e6b0" stroke-width="4"/><circle cx="60" cy="16" r="6" fill="#f9e6b0"/><rect x="24" y="35" width="72" height="61" rx="19" fill="#e1e6e4"/><rect x="32" y="45" width="56" height="29" rx="10" fill="#243a47"/><circle cx="44" cy="59" r="5" fill="#86e4d0"/><circle cx="76" cy="59" r="5" fill="#86e4d0"/><path d="M49 85h22" stroke="#243a47" stroke-width="4" stroke-linecap="round"/>',
    orbit: '<circle cx="60" cy="60" r="27" fill="#f4d895"/><ellipse cx="60" cy="60" rx="48" ry="14" transform="rotate(-30 60 60)" fill="none" stroke="#fff3d7" stroke-width="5"/><circle cx="91" cy="24" r="4" fill="#fff3d7"/>',
    wave: '<circle cx="79" cy="33" r="13" fill="#f4d895"/><path d="M0 74q20-42 44 0t44 0 44 0v46H0z" fill="#cce6dc"/><path d="M0 94q20-32 44 0t44 0 44 0v26H0z" fill="#173c52"/>',
  }
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120" rx="24" fill="${backdrop}"/>${faces[validAvatar(avatar)]}</svg>`)}`
}
