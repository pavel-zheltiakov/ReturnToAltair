// The two things on this site that need script: the download panel, and the release list.
//
// Both are fed from the same place — the public repository's releases — so no version number and
// no download URL is written down twice. A page that names a file has to be edited on the day the
// file changes, and the edit that gets forgotten is always the one on the page nobody reading it
// can tell is stale.
//
// Progressive enhancement, no dependencies, no build step. Without JavaScript the download button
// still goes to the Releases page and the releases page still says where the history is, which is
// two more clicks and no dead ends.

(function () {
    'use strict';

    var REPOSITORY = 'pavel-zheltiakov/ReturnToAltair';
    var RELEASES = 'https://github.com/' + REPOSITORY + '/releases';
    var API = 'https://api.github.com/repos/' + REPOSITORY + '/releases';

    // Every build there is, in the order a reader scans them. One row per *file*, not one per
    // platform-and-architecture: the macOS bundle is universal, so splitting it into an Apple
    // silicon row and an Intel row would be the same download listed twice under two names.
    var BUILDS = [
        { platform: 'macos', arch: 'universal', label: 'macOS · ARM64/x64 (*.dmg)' },
        { platform: 'windows', arch: 'arm64', label: 'Windows · ARM64 (*.zip)' },
        { platform: 'windows', arch: 'x64', label: 'Windows · x64 (*.zip)' },
        { platform: 'linux', arch: 'arm64', label: 'Linux · ARM64 (*.AppImage)' },
        { platform: 'linux', arch: 'x64', label: 'Linux · x64 (*.AppImage)' }
    ];

    // Which file in a release is which build. Matched on the end of the name rather than by
    // searching for "x64" anywhere in it — `win-x64.zip` and `x64.AppImage` both contain the
    // architecture, and a substring test hands a Linux visitor a Windows zip.
    function asset(release, build) {
        var files = release.assets || [];

        for (var i = 0; i < files.length; i++) {
            var name = files[i].name;

            if (build.platform === 'macos' && /\.dmg$/.test(name)) return files[i];
            if (build.platform === 'windows' && name.indexOf('-win-' + build.arch + '.zip') > 0) return files[i];

            if (build.platform === 'linux') {
                // The AppImage is the build; the tarball is what package.sh writes when the
                // machine had no appimagetool. Either is a working download, so take whichever
                // the release actually carries.
                if (name.indexOf('-' + build.arch + '.AppImage') > 0) return files[i];
                if (name.indexOf('-linux-' + build.arch + '.tar.gz') > 0) return files[i];
            }
        }

        return null;
    }

    function megabytes(bytes) {
        return bytes ? (bytes / 1048576).toFixed(1) + ' MB' : '';
    }

    function escape(text) {
        return String(text)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // The newest release, prereleases included. GitHub's own `/releases/latest` skips them, and
    // every build of this game is an alpha — so that endpoint would report nothing at all.
    var newest = fetch(API)
        .then(function (response) { return response.ok ? response.json() : null; })
        .catch(function () { return null; });

    // ---- the download panel --------------------------------------------------------------------
    //
    // Every link on the panel — the three platform buttons and the six architecture tabs — carries
    // a `data-build` of "platform-arch", and this fills in its href from the newest release. Until
    // that arrives the buttons already point at the Releases page, so a visitor who clicks in the
    // first half-second lands somewhere useful rather than on "#".

    (function () {
        var panel = document.querySelector('.get');
        if (!panel) return;

        var note = document.getElementById('download-note');
        var links = Array.prototype.slice.call(panel.querySelectorAll('[data-build]'));

        function fill(release) {
            links.forEach(function (link) {
                var parts = link.dataset.build.split('-');
                // "macos-universal" — one bundle covers both chips, and `asset` matches the .dmg
                // whatever architecture it is asked for.
                var build = { platform: parts[0], arch: parts[1] };
                var file = release ? asset(release, build) : null;
                var size = link.querySelector('[data-size]');

                if (file) {
                    link.href = file.browser_download_url;
                    link.title = file.name;
                    link.removeAttribute('aria-disabled');
                    if (size) size.textContent = ' · ' + megabytes(file.size);
                    return;
                }

                // No such file in this release. The big button still goes to the Releases page —
                // whatever the reason this site cannot name the file, GitHub can — and the tab,
                // which exists only to name one file, stops pretending to be a link.
                if (size) size.textContent = ' · —';

                if (link.classList.contains('tab')) {
                    link.setAttribute('aria-disabled', 'true');
                    link.removeAttribute('href');
                } else {
                    link.href = RELEASES;
                }
            });
        }

        newest.then(function (all) {
            // Three different nothings, and they need three different sentences: GitHub could not
            // be reached, GitHub was reached and there are no releases, and there is a release that
            // does not carry a particular file. Telling a visitor the site is broken when the
            // answer is "not published yet" sends them away for good.
            var reached = Array.isArray(all);
            var release = reached && all.length ? all[0] : null;

            fill(release);

            if (release) {
                note.innerHTML = 'Version <b>' + escape(release.tag_name) + '</b> · ' +
                    '<a href="releases.html">what changed</a>';
            } else if (reached) {
                // No mention of the browser here. Whether that half of the site is live depends
                // on how it was published (avalonia/publish.sh --site-only leaves a note in
                // play/ instead of the game), and a fallback line is the wrong place to make a
                // promise this script cannot check.
                note.innerHTML = 'The first build has not been published yet — ' +
                    '<a href="' + RELEASES + '">watch the releases page</a>, which is where it ' +
                    'lands the moment it exists.';
            } else {
                note.innerHTML = 'Could not reach GitHub for the file list. ' +
                    '<a href="' + RELEASES + '">The releases page</a> has every build.';
            }
        });
    })();

    // ---- the release list ----------------------------------------------------------------------
    //
    // Fed live from the repository's releases, with the release being prepared right now — which
    // has no tag and therefore no GitHub release — carried by releases-local.js until the tag is
    // pushed. An entry whose tag already exists there is dropped rather than shown twice.
    //
    // The bodies are the release notes, which are Markdown, so there is a small renderer here. It
    // handles what RELEASE_NOTES.md uses — headings, bullets, bold, inline code, tables, links —
    // and nothing else. A Markdown library would be larger than this whole site.

    (function () {
        var host = document.getElementById('releases');
        if (!host) return;

        function inline(text) {
            return escape(text)
                .replace(/`([^`]+)`/g, '<code>$1</code>')
                .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
                .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
                .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>')
                .replace(/(^|[\s>])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2">$2</a>');
        }

        function cells(row) {
            return row.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(function (c) {
                return c.trim();
            });
        }

        // The footer the release workflow appends is already on this page as a list of files and a
        // button, so it is dropped rather than shown twice.
        function furniture(line) {
            return /^(Download|Play|Docs|Install):/.test(line) || line === '---';
        }

        // Whether a line is the continuation of the bullet above it rather than the start of
        // anything. The notes are written to a column width like every other file here, and
        // without this every wrapped bullet ended its list and came out as a paragraph under it.
        function continues(line) {
            var trimmed = line.trim();
            return trimmed !== '' && !/^[-*]\s+/.test(trimmed) && !/^#{1,3}\s+/.test(trimmed) &&
                trimmed.charAt(0) !== '|' && !furniture(trimmed);
        }

        function render(markdown) {
            var lines = String(markdown).replace(/\r\n/g, '\n').split('\n');
            var html = '';
            var paragraph = [];

            function flush() {
                if (!paragraph.length) return;
                html += '<p>' + inline(paragraph.join(' ')) + '</p>';
                paragraph = [];
            }

            for (var i = 0; i < lines.length; i++) {
                var trimmed = lines[i].trim();

                if (furniture(trimmed) || !trimmed) { flush(); continue; }

                if (/^###\s+/.test(trimmed)) { flush(); html += '<h4>' + inline(trimmed.slice(4)) + '</h4>'; continue; }
                if (/^##\s+/.test(trimmed)) { flush(); html += '<h3>' + inline(trimmed.slice(3)) + '</h3>'; continue; }
                if (/^#\s+/.test(trimmed)) { flush(); html += '<h3>' + inline(trimmed.slice(2)) + '</h3>'; continue; }

                // A table: a header row, an alignment row, then body rows until the block ends.
                if (trimmed.charAt(0) === '|' && /^\|[\s:|-]+\|$/.test((lines[i + 1] || '').trim())) {
                    flush();
                    html += '<div class="scroller"><table><thead><tr>' + cells(trimmed).map(function (c) {
                        return '<th>' + inline(c) + '</th>';
                    }).join('') + '</tr></thead><tbody>';

                    for (i += 2; i < lines.length && lines[i].trim().charAt(0) === '|'; i++)
                        html += '<tr>' + cells(lines[i].trim()).map(function (c) {
                            return '<td>' + inline(c) + '</td>';
                        }).join('') + '</tr>';

                    i--;
                    html += '</tbody></table></div>';
                    continue;
                }

                if (/^[-*]\s+/.test(trimmed)) {
                    flush();
                    html += '<ul>';
                    for (; i < lines.length && /^[-*]\s+/.test(lines[i].trim()); i++) {
                        var item = lines[i].trim().slice(2);
                        while (i + 1 < lines.length && continues(lines[i + 1])) item += ' ' + lines[++i].trim();
                        html += '<li>' + inline(item) + '</li>';
                    }
                    i--;
                    html += '</ul>';
                    continue;
                }

                paragraph.push(trimmed);
            }

            flush();
            return html;
        }

        // Six files, under the notes and small. A reader who has come this far knows which one is
        // theirs; this is a reference table, not the offer — the offer is the picker on the front
        // page. A build the release has not got keeps its row and goes quiet, so the list is always
        // the same six lines and a gap is visible as a gap.
        function assets(release) {
            var rows = BUILDS.map(function (build) {
                var file = asset(release, build);

                return '<li>' + (file
                    ? '<a href="' + escape(file.browser_download_url) + '">' + escape(build.label) + '</a>' +
                      '<span>' + escape(megabytes(file.size)) + '</span>'
                    : '<span>' + escape(build.label) + '</span><span>—</span>') + '</li>';
            }).join('');

            return '<div class="assets"><b>Downloads</b><ul>' + rows + '</ul></div>';
        }

        function card(release) {
            // Release dates are date-only stamps at UTC midnight; formatting them in local time
            // shows the previous day everywhere west of UTC.
            var date = release.published_at
                ? new Date(release.published_at).toLocaleDateString('en-GB', {
                    timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric'
                })
                : '';

            var prerelease = release.prerelease || /-/.test(release.tag_name || '');

            return '<article class="rel">' +
                '<h3>' + escape(release.name || release.tag_name) +
                (prerelease ? ' <span class="rel-pre">prerelease</span>' : '') +
                (date ? ' <span class="rel-date">' + escape(date) + '</span>' : '') + '</h3>' +
                '<div class="rel-body">' + render(release.body || '') + '</div>' +
                assets(release) +
                '<p class="footnote">' +
                '<a href="' + escape(release.html_url || RELEASES) + '">This release on GitHub</a>.' +
                '</p>' +
                '</article>';
        }

        function note(text) {
            return '<p class="footnote">' + text + ' Read it on <a href="' + RELEASES + '">GitHub</a>.</p>';
        }

        newest.then(function (fetched) {
            var published = Array.isArray(fetched) ? fetched : [];
            var pending = (window.LOCAL_RELEASES || []).filter(function (local) {
                return !published.some(function (r) { return r.tag_name === local.tag_name; });
            });

            var all = pending.concat(published);

            // A failed fetch with a pending entry still needs the notice — otherwise the page
            // presents an unreleased version as the only one there has ever been.
            var warning = fetched === null ? note('The release history could not be loaded.') : '';

            host.innerHTML = all.length
                ? warning + all.map(card).join('')
                : warning || note('No releases yet — the first one is on its way.');
        });
    })();
})();
