// Higher is better: playing with a title, paused with a title, anything else still alive.
// trackTitle can't tell: the shell fills in "Unknown title", so silent apps (Electron notification
// sounds) would look like music and take the island over from what's really playing.
function rank(player) {
    if (!player._playerProxy || !player.status || player.status === 'Stopped')
        return 0;
    const title = player._playerProxy.Metadata?.['xesam:title']?.deepUnpack();
    // An empty title is the one case the shell doesn't replace, and the island won't show it
    if (title === '')
        return 0;
    if (!title)
        return 1;
    return player.status === 'Playing' ? 3 : 2;
}

// Which player the island shows, null for none. `changed` is the player that just reported a change:
// on a tie it beats the current one if it's playing, so the last playing player to report anything takes over.
export function pickPlayer(players, current, changed = null) {
    const candidates = [changed?.status === 'Playing' ? changed : null, current, ...players].filter(Boolean);
    let best = null;
    for (const player of candidates) {
        if (rank(player) > (best ? rank(best) : 0))
            best = player;
    }
    return best;
}
