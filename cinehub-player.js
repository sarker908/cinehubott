/* ═══════════════════════════════════════════════════════
   CINEHUB — cinehub-player.js
   Custom player for DIRECT sources only (HLS.js / HTML5 <video>).
   Embedded providers never touch this file — they stay on the existing
   iframe flow in script.js.
═══════════════════════════════════════════════════════ */

(function (global) {
    'use strict';

    class CineHubPlayer {
        constructor(containerEl, opts = {}) {
            this.container = containerEl;
            this.opts = opts; // { onAllFailed, onEnded, onProgress, onNextEpisode }
            this.hls = null;
            this.streams = [];
            this.currentIndex = -1;
            this.video = null;
            this.controlsHideTimer = null;
            this._buildDom();
        }

        _buildDom() {
            this.container.innerHTML = `
                <div class="chp-root" tabindex="-1">
                    <video class="chp-video" playsinline webkit-playsinline></video>
                    <div class="chp-state chp-loading" style="display:none">
                        <div class="chp-spinner"></div>
                        <div class="chp-state-label">Finding best source…</div>
                    </div>
                    <div class="chp-state chp-error" style="display:none">
                        <i class="fas fa-triangle-exclamation"></i>
                        <div class="chp-state-label">Playback failed</div>
                    </div>
                    <div class="chp-controls">
                        <div class="chp-progress-row">
                            <input type="range" class="chp-seek" min="0" max="1000" value="0" step="1">
                        </div>
                        <div class="chp-controls-row">
                            <button class="chp-btn chp-play" title="Play/Pause"><i class="fas fa-play"></i></button>
                            <span class="chp-time">0:00 / 0:00</span>
                            <button class="chp-btn chp-mute" title="Mute"><i class="fas fa-volume-high"></i></button>
                            <input type="range" class="chp-volume" min="0" max="1" step="0.05" value="1">
                            <span class="chp-spacer"></span>
                            <div class="chp-menu-wrap">
                                <button class="chp-btn chp-speed-btn" title="Playback speed">1x</button>
                                <div class="chp-menu chp-speed-menu"></div>
                            </div>
                            <div class="chp-menu-wrap">
                                <button class="chp-btn chp-quality-btn" title="Quality"><i class="fas fa-gear"></i></button>
                                <div class="chp-menu chp-quality-menu"></div>
                            </div>
                            <div class="chp-menu-wrap">
                                <button class="chp-btn chp-cc-btn" title="Subtitles"><i class="fas fa-closed-captioning"></i></button>
                                <div class="chp-menu chp-cc-menu"></div>
                            </div>
                            <div class="chp-menu-wrap">
                                <button class="chp-btn chp-audio-btn" title="Audio track" style="display:none"><i class="fas fa-headphones"></i></button>
                                <div class="chp-menu chp-audio-menu"></div>
                            </div>
                            <button class="chp-btn chp-pip" title="Picture in picture"><i class="fas fa-clone"></i></button>
                            <button class="chp-btn chp-fullscreen" title="Fullscreen"><i class="fas fa-expand"></i></button>
                        </div>
                    </div>
                </div>
            `;
            this.root      = this.container.querySelector('.chp-root');
            this.video     = this.container.querySelector('.chp-video');
            this.loadingEl = this.container.querySelector('.chp-loading');
            this.errorEl   = this.container.querySelector('.chp-error');
            this.seekEl    = this.container.querySelector('.chp-seek');
            this.playBtn   = this.container.querySelector('.chp-play');
            this.timeEl    = this.container.querySelector('.chp-time');
            this.muteBtn   = this.container.querySelector('.chp-mute');
            this.volumeEl  = this.container.querySelector('.chp-volume');
            this.speedBtn  = this.container.querySelector('.chp-speed-btn');
            this.speedMenu = this.container.querySelector('.chp-speed-menu');
            this.qualityBtn= this.container.querySelector('.chp-quality-btn');
            this.qualityMenu = this.container.querySelector('.chp-quality-menu');
            this.ccBtn     = this.container.querySelector('.chp-cc-btn');
            this.ccMenu    = this.container.querySelector('.chp-cc-menu');
            this.audioBtn  = this.container.querySelector('.chp-audio-btn');
            this.audioMenu = this.container.querySelector('.chp-audio-menu');
            this.pipBtn    = this.container.querySelector('.chp-pip');
            this.fsBtn     = this.container.querySelector('.chp-fullscreen');

            this._wireEvents();
            this._buildSpeedMenu();
        }

        _wireEvents() {
            const v = this.video;

            this.playBtn.addEventListener('click', () => this.togglePlay());
            v.addEventListener('click', () => this.togglePlay());
            v.addEventListener('play',  () => { this._setPlayIcon(true); this._showControls(); });
            v.addEventListener('pause', () => { this._setPlayIcon(false); this._showControls(true); });

            v.addEventListener('loadstart', () => this._setLoading(true));
            v.addEventListener('waiting',   () => this._setLoading(true));
            v.addEventListener('playing',   () => this._setLoading(false));
            v.addEventListener('canplay',   () => this._setLoading(false));

            v.addEventListener('timeupdate', () => this._onTimeUpdate());
            v.addEventListener('durationchange', () => this._onTimeUpdate());
            v.addEventListener('volumechange', () => {
                this.muteBtn.innerHTML = `<i class="fas fa-volume-${v.muted || v.volume === 0 ? 'xmark' : 'high'}"></i>`;
            });
            v.addEventListener('ended', () => { if (this.opts.onEnded) this.opts.onEnded(); });
            v.addEventListener('error', () => this._handlePlaybackError());

            this.seekEl.addEventListener('input', () => {
                if (!isFinite(v.duration)) return;
                v.currentTime = (this.seekEl.value / 1000) * v.duration;
            });

            this.muteBtn.addEventListener('click', () => { v.muted = !v.muted; });
            this.volumeEl.addEventListener('input', () => {
                v.volume = parseFloat(this.volumeEl.value);
                v.muted = v.volume === 0;
            });

            this.pipBtn.addEventListener('click', async () => {
                try {
                    if (document.pictureInPictureElement) await document.exitPictureInPicture();
                    else if (v.requestPictureInPicture) await v.requestPictureInPicture();
                } catch (e) { /* PiP unsupported/blocked — non-fatal */ }
            });

            this.fsBtn.addEventListener('click', () => this.toggleFullscreen());
            document.addEventListener('fullscreenchange', () => this._onFullscreenChange());
            document.addEventListener('webkitfullscreenchange', () => this._onFullscreenChange());

            [this.speedBtn, this.qualityBtn, this.ccBtn, this.audioBtn].forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const menu = btn.nextElementSibling;
                    const wasOpen = menu.classList.contains('open');
                    this.container.querySelectorAll('.chp-menu.open').forEach(m => m.classList.remove('open'));
                    if (!wasOpen) menu.classList.add('open');
                });
            });
            document.addEventListener('click', () => {
                this.container.querySelectorAll('.chp-menu.open').forEach(m => m.classList.remove('open'));
            });

            // auto-hide controls while playing — mouse for desktop, touch for mobile
            this.root.addEventListener('mousemove', () => this._showControls());
            this.root.addEventListener('mouseleave', () => this._maybeHideControls());
            this.root.addEventListener('touchstart', () => {
                // First tap just reveals controls instead of immediately toggling
                // play/pause underneath a finger, which felt glitchy on mobile.
                if (!this.root.classList.contains('chp-controls-visible')) {
                    this._showControls();
                } else {
                    this._showControls();
                }
            }, { passive: true });
        }

        toggleFullscreen() {
            const isFs = document.fullscreenElement || document.webkitFullscreenElement;
            if (isFs) {
                (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
                return;
            }
            const el = this.root;
            const request = el.requestFullscreen || el.webkitRequestFullscreen;
            if (request) {
                request.call(el).catch?.(() => {});
            } else if (this.video.webkitEnterFullscreen) {
                // iOS Safari doesn't support Fullscreen API on arbitrary elements —
                // only the <video> element itself supports native fullscreen there.
                // Controls become the OS-native ones in that case, which is the
                // platform's own limitation, not something CineHub can override.
                this.video.webkitEnterFullscreen();
            }
        }

        _onFullscreenChange() {
            const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
            this.root.classList.toggle('chp-fullscreen-active', isFs);
            this.fsBtn.innerHTML = `<i class="fas fa-${isFs ? 'compress' : 'expand'}"></i>`;
        }

        _buildSpeedMenu() {
            const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2];
            this.speedMenu.innerHTML = speeds.map(s => `<button class="chp-menu-item${s === 1 ? ' chp-active' : ''}" data-speed="${s}">${s}x</button>`).join('');
            this.speedMenu.querySelectorAll('.chp-menu-item').forEach(btn => {
                btn.addEventListener('click', () => {
                    const s = parseFloat(btn.dataset.speed);
                    this.video.playbackRate = s;
                    this.speedBtn.textContent = s + 'x';
                    this.speedMenu.querySelectorAll('.chp-menu-item').forEach(b => b.classList.remove('chp-active'));
                    btn.classList.add('chp-active');
                    this.speedMenu.classList.remove('open');
                });
            });
        }

        _setPlayIcon(isPlaying) {
            this.playBtn.innerHTML = `<i class="fas fa-${isPlaying ? 'pause' : 'play'}"></i>`;
        }

        _setLoading(on) {
            this.loadingEl.style.display = on ? 'flex' : 'none';
        }

        _showError(msg) {
            this.errorEl.querySelector('.chp-state-label').textContent = msg || 'Playback failed';
            this.errorEl.style.display = 'flex';
        }
        _hideError() { this.errorEl.style.display = 'none'; }

        _showControls(persistent) {
            this.root.classList.add('chp-controls-visible');
            clearTimeout(this.controlsHideTimer);
            if (!persistent) {
                this.controlsHideTimer = setTimeout(() => this._maybeHideControls(), 2800);
            }
        }
        _maybeHideControls() {
            if (this.video && !this.video.paused) this.root.classList.remove('chp-controls-visible');
        }

        _onTimeUpdate() {
            const v = this.video;
            if (!isFinite(v.duration) || v.duration <= 0) return;
            this.seekEl.value = Math.round((v.currentTime / v.duration) * 1000);
            this.timeEl.textContent = `${fmtTime(v.currentTime)} / ${fmtTime(v.duration)}`;
            if (this.opts.onProgress) this.opts.onProgress(v.currentTime, v.duration);
        }

        togglePlay() {
            if (this.video.paused) this.video.play().catch(() => {});
            else this.video.pause();
        }

        // ── loading a ranked list of direct streams ──
        // Tries streams[0]; on playback error, automatically advances to
        // the next DIRECT stream only (rule #9). Once the list is
        // exhausted, calls onAllFailed() and does nothing further — it
        // never reaches for an embedded provider itself.
        load(streams, { resumeSeconds = 0 } = {}) {
            this.streams = streams || [];
            this.currentIndex = -1;
            this._hideError();
            this._resumeSeconds = resumeSeconds;
            this._tryNext();
        }

        _tryNext() {
            this._stopSilentAudioWatch();
            this.currentIndex++;
            if (this.currentIndex >= this.streams.length) {
                this._setLoading(false);
                this._showError('All direct sources failed');
                if (this.opts.onAllFailed) this.opts.onAllFailed();
                return;
            }
            const stream = this.streams[this.currentIndex];
            this._setLoading(true);
            this._hideError();
            this._loadStream(stream);
        }

        _loadStream(stream) {
            this._destroyHls();
            const v = this.video;
            v.removeAttribute('src');
            v.muted = false; // never force-mute a new stream — this was silently starving audio on some sources
            this._clearSubtitleTracks();
            this._populateSubtitleMenu(stream.subtitles);
            this._resetAudioMenu();

            if (stream.streamType === 'hls') {
                if (v.canPlayType('application/vnd.apple.mpegurl')) {
                    // native HLS (Safari/iOS) — audio track switching there goes
                    // through the standard AudioTrackList API, not hls.js.
                    v.src = stream.url;
                    v.addEventListener('loadedmetadata', () => this._populateNativeAudioMenu(), { once: true });
                } else if (global.Hls && global.Hls.isSupported()) {
                    const hls = new global.Hls({ maxBufferLength: 30 });
                    this.hls = hls;
                    hls.on(global.Hls.Events.ERROR, (evt, data) => {
                        // Chrome-specific real-world cause of "video plays, no
                        // sound": the alternate-audio rendition's playlist/segments
                        // 404 or fail CORS while the video rendition loads fine.
                        // hls.js reports this as audioTrackLoadError, usually
                        // non-fatal, so it was previously falling through the
                        // `!data.fatal` early-return below and just staying silent
                        // forever. Handle it explicitly: try another audio track
                        // if one exists, otherwise treat this source as broken.
                        if (data.details === global.Hls.ErrorDetails?.AUDIO_TRACK_LOAD_ERROR) {
                            const tracks = hls.audioTracks || [];
                            const next = tracks.findIndex((t, i) => i !== hls.audioTrack);
                            if (next !== -1) {
                                hls.audioTrack = next;
                            } else {
                                this._handlePlaybackError();
                            }
                            return;
                        }

                        // Only bail out to the next direct source on genuinely
                        // fatal errors — a lot of "glitchy" playback was actually
                        // hls.js recovering from non-fatal buffer stalls that we
                        // were treating as failures.
                        if (!data.fatal) return;
                        if (data.type === global.Hls.ErrorTypes.NETWORK_ERROR) {
                            try { hls.startLoad(); return; } catch (e) {}
                        } else if (data.type === global.Hls.ErrorTypes.MEDIA_ERROR) {
                            try { hls.recoverMediaError(); return; } catch (e) {}
                        }
                        this._handlePlaybackError();
                    });
                    hls.on(global.Hls.Events.MANIFEST_PARSED, () => this._populateQualityMenu());
                    hls.on(global.Hls.Events.AUDIO_TRACKS_UPDATED, () => this._populateAudioMenu());
                    hls.on(global.Hls.Events.AUDIO_TRACK_SWITCHED, () => {
                        this._highlightActiveAudioTrack();
                        this._startSilentAudioWatch(); // give the newly-selected track a fresh window to prove it has sound
                    });
                    hls.loadSource(stream.url);
                    hls.attachMedia(v);
                } else {
                    this._handlePlaybackError();
                    return;
                }
            } else {
                v.src = stream.url;
                this.qualityMenu.innerHTML = '<div class="chp-menu-item chp-menu-disabled">Auto</div>';
                v.addEventListener('loadedmetadata', () => this._populateNativeAudioMenu(), { once: true });
            }

            const onReady = () => {
                if (this._resumeSeconds) { v.currentTime = this._resumeSeconds; this._resumeSeconds = 0; }
                v.play().catch(() => {}); // autoplay may be blocked — user can hit play
                v.removeEventListener('loadedmetadata', onReady);
            };
            v.addEventListener('loadedmetadata', onReady);

            this.activeSourceLabel = `${stream.provider}${stream.quality ? ' • ' + stream.quality + 'p' : ''}${stream.language ? ' • ' + stream.language : ''}`;
            this._showControls(); // always start with controls visible on a fresh load
            this._startSilentAudioWatch();
        }

        // ── silent-video detection (section 17) ──
        // Chrome exposes video.webkitAudioDecodedByteCount, which counts bytes
        // of audio actually decoded — independent of the mute button/volume,
        // since decoding still happens even when muted. If the video is
        // genuinely advancing (currentTime moving) but this stays at 0 across
        // two checks, the picture is playing with no real audio behind it —
        // exactly the "video: supported, audio: unsupported" case this spec
        // calls out. That's treated as a real fatal failure for THIS direct
        // source and falls through to the next one in the ranked list — never
        // to an embedded provider.
        _startSilentAudioWatch() {
            this._stopSilentAudioWatch();
            const v = this.video;
            if (typeof v.webkitAudioDecodedByteCount !== 'number') return; // not supported on this browser — skip, don't guess

            let lastBytes = -1;
            let lastTime = -1;
            let strikes = 0;
            const streamAtStart = this.currentIndex;

            this._silentWatchTimer = setInterval(() => {
                if (v.paused || v.ended) return;
                if (this.currentIndex !== streamAtStart) { this._stopSilentAudioWatch(); return; }

                const bytes = v.webkitAudioDecodedByteCount;
                const advancing = lastTime >= 0 && (v.currentTime - lastTime) > 1;
                const audioStalled = lastBytes >= 0 && bytes === lastBytes;

                if (advancing && audioStalled && bytes === 0) {
                    strikes++;
                    if (strikes >= 2) {
                        this._stopSilentAudioWatch();
                        this._handlePlaybackError(); // move to next direct source — this one has no audio
                        return;
                    }
                } else {
                    strikes = 0;
                }
                lastBytes = bytes;
                lastTime = v.currentTime;
            }, 4000);
        }

        _stopSilentAudioWatch() {
            if (this._silentWatchTimer) { clearInterval(this._silentWatchTimer); this._silentWatchTimer = null; }
        }

        _handlePlaybackError() {
            // Advance to the next direct source only — never an embedded one.
            this._tryNext();
        }

        _populateQualityMenu() {
            if (!this.hls) return;
            const levels = this.hls.levels || [];
            const items = ['<button class="chp-menu-item chp-active" data-level="-1">Auto</button>']
                .concat(levels.map((l, i) => `<button class="chp-menu-item" data-level="${i}">${l.height}p</button>`));
            this.qualityMenu.innerHTML = items.join('');
            this.qualityMenu.querySelectorAll('.chp-menu-item').forEach(btn => {
                btn.addEventListener('click', () => {
                    const level = parseInt(btn.dataset.level, 10);
                    this.hls.currentLevel = level;
                    this.qualityMenu.querySelectorAll('.chp-menu-item').forEach(b => b.classList.remove('chp-active'));
                    btn.classList.add('chp-active');
                    this.qualityMenu.classList.remove('open');
                });
            });
        }

        _clearSubtitleTracks() {
            this.video.querySelectorAll('track').forEach(t => t.remove());
            if (this._extSubtitleUrl) { URL.revokeObjectURL(this._extSubtitleUrl); this._extSubtitleUrl = null; }
        }

        // subtitles: addon-supplied ones (if any) PLUS an on-demand "search"
        // list — CineHub's Subdl-backed lookup (wired in via opts.onSearchSubtitles
        // from script.js), since most direct addons don't return subtitle URLs.
        _populateSubtitleMenu(subtitles) {
            const searchLangs = ['English', 'Hindi', 'Spanish', 'French', 'Arabic', 'German'];
            const items = ['<button class="chp-menu-item chp-active" data-lang="off">Off</button>'];

            (subtitles || []).forEach((s, i) => {
                items.push(`<button class="chp-menu-item" data-idx="${i}">${escapeHtml(s.lang)}</button>`);
                const track = document.createElement('track');
                track.kind = 'subtitles';
                track.label = s.lang;
                track.srclang = (s.lang || 'und').slice(0, 2);
                track.src = s.url;
                this.video.appendChild(track);
            });

            if (this.opts.onSearchSubtitles) {
                items.push('<div class="chp-menu-sep"></div>');
                searchLangs.forEach(lang => items.push(`<button class="chp-menu-item" data-search="${escapeHtml(lang)}">${escapeHtml(lang)} <i class="fas fa-magnifying-glass"></i></button>`));
            }

            this.ccMenu.innerHTML = items.join('');
            this._wireSubtitleMenuItems();
        }

        _wireSubtitleMenuItems() {
            this.ccMenu.querySelectorAll('.chp-menu-item[data-idx], .chp-menu-item[data-lang="off"]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const tracks = this.video.textTracks;
                    for (let i = 0; i < tracks.length; i++) tracks[i].mode = 'disabled';
                    if (btn.dataset.idx !== undefined) {
                        const idx = parseInt(btn.dataset.idx, 10);
                        if (tracks[idx]) tracks[idx].mode = 'showing';
                    }
                    this._setActiveSubtitleButton(btn);
                    this.ccMenu.classList.remove('open');
                });
            });

            this.ccMenu.querySelectorAll('.chp-menu-item[data-search]').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const lang = btn.dataset.search;
                    const original = btn.innerHTML;
                    btn.innerHTML = `${escapeHtml(lang)} <i class="fas fa-spinner fa-spin"></i>`;
                    try {
                        const vttUrl = await this.opts.onSearchSubtitles(lang);
                        if (!vttUrl) { btn.innerHTML = `${escapeHtml(lang)} <i class="fas fa-xmark"></i> not found`; return; }

                        if (this._extSubtitleUrl) URL.revokeObjectURL(this._extSubtitleUrl);
                        this._extSubtitleUrl = vttUrl;

                        const tracks = this.video.textTracks;
                        for (let i = 0; i < tracks.length; i++) tracks[i].mode = 'disabled';
                        const track = document.createElement('track');
                        track.kind = 'subtitles';
                        track.label = lang;
                        track.default = true;
                        track.src = vttUrl;
                        track.addEventListener('load', () => { track.track.mode = 'showing'; });
                        this.video.appendChild(track);
                        // Some browsers apply `default` immediately without firing 'load'
                        setTimeout(() => { if (track.track) track.track.mode = 'showing'; }, 150);

                        btn.innerHTML = `${escapeHtml(lang)} <i class="fas fa-check"></i>`;
                        this._setActiveSubtitleButton(btn);
                        this.ccMenu.classList.remove('open');
                    } catch (err) {
                        btn.innerHTML = `${escapeHtml(lang)} <i class="fas fa-xmark"></i> failed`;
                    } finally {
                        setTimeout(() => { if (btn.isConnected) btn.innerHTML = original; }, 2500);
                    }
                });
            });
        }

        _setActiveSubtitleButton(activeBtn) {
            this.ccMenu.querySelectorAll('.chp-menu-item').forEach(b => b.classList.remove('chp-active'));
            activeBtn.classList.add('chp-active');
        }

        // ── dual-audio / multi-audio-track support ──
        _resetAudioMenu() {
            this.audioBtn.style.display = 'none';
            this.audioMenu.innerHTML = '';
        }

        _populateAudioMenu() {
            if (!this.hls) return;
            const tracks = this.hls.audioTracks || [];

            // Fix: if hls.js parsed the manifest but never actually settled on
            // an audio track (audioTrack === -1), the video plays with no sound
            // until one is explicitly selected. Force the first one so audio
            // isn't silently missing by default.
            if (tracks.length && this.hls.audioTrack === -1) {
                this.hls.audioTrack = 0;
            }

            if (tracks.length <= 1) { this._resetAudioMenu(); return; }

            this.audioBtn.style.display = 'inline-flex';
            this.audioMenu.innerHTML = tracks.map((t, i) => {
                const label = t.name || t.lang || `Track ${i + 1}`;
                return `<button class="chp-menu-item${i === this.hls.audioTrack ? ' chp-active' : ''}" data-audio="${i}">${escapeHtml(label)}</button>`;
            }).join('');

            this.audioMenu.querySelectorAll('.chp-menu-item').forEach(btn => {
                btn.addEventListener('click', () => {
                    const idx = parseInt(btn.dataset.audio, 10);
                    this.hls.audioTrack = idx;
                    this._highlightActiveAudioTrack();
                    this.audioMenu.classList.remove('open');
                });
            });
        }

        _highlightActiveAudioTrack() {
            if (!this.hls) return;
            this.audioMenu.querySelectorAll('.chp-menu-item').forEach(b => {
                b.classList.toggle('chp-active', parseInt(b.dataset.audio, 10) === this.hls.audioTrack);
            });
        }

        // Native <video>.audioTracks (Safari/WebKit) — used when playing native
        // HLS or a file with embedded alternate audio tracks without hls.js.
        _populateNativeAudioMenu() {
            const list = this.video.audioTracks;
            if (!list || list.length <= 1) { this._resetAudioMenu(); return; }

            this.audioBtn.style.display = 'inline-flex';
            const items = [];
            for (let i = 0; i < list.length; i++) {
                const t = list[i];
                items.push(`<button class="chp-menu-item${t.enabled ? ' chp-active' : ''}" data-native-audio="${i}">${escapeHtml(t.label || t.language || 'Track ' + (i + 1))}</button>`);
            }
            this.audioMenu.innerHTML = items.join('');
            this.audioMenu.querySelectorAll('.chp-menu-item').forEach(btn => {
                btn.addEventListener('click', () => {
                    const idx = parseInt(btn.dataset.nativeAudio, 10);
                    for (let i = 0; i < list.length; i++) list[i].enabled = (i === idx);
                    this.audioMenu.querySelectorAll('.chp-menu-item').forEach(b => b.classList.remove('chp-active'));
                    btn.classList.add('chp-active');
                    this.audioMenu.classList.remove('open');
                });
            });
        }

        currentTime() { return this.video?.currentTime || 0; }
        duration() { return this.video?.duration || 0; }

        _destroyHls() {
            if (this.hls) { try { this.hls.destroy(); } catch (e) {} this.hls = null; }
        }

        destroy() {
            this._destroyHls();
            this._stopSilentAudioWatch();
            clearTimeout(this.controlsHideTimer);
            if (this._extSubtitleUrl) { URL.revokeObjectURL(this._extSubtitleUrl); this._extSubtitleUrl = null; }
            if (this.video) {
                this.video.pause();
                this.video.removeAttribute('src');
                this.video.load();
            }
            this.container.innerHTML = '';
        }
    }

    function fmtTime(sec) {
        if (!isFinite(sec) || sec < 0) return '0:00';
        const m = Math.floor(sec / 60);
        const s = Math.floor(sec % 60);
        return `${m}:${s.toString().padStart(2, '0')}`;
    }

    function escapeHtml(s) {
        return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    global.CineHubPlayer = CineHubPlayer;

})(window);