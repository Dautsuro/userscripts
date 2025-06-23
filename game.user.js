// ==UserScript==
// @name         Game
// @namespace    https://github.com/Dautsuro/userscripts
// @version      1.0.0
// @description  Manager for videos in HTML games.
// @match        file:///C:/Games/*/*/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=69shuba.com
// @grant        GM.getValue
// @grant        GM.setValue
// @downloadURL  https://raw.githubusercontent.com/Dautsuro/userscripts/main/game.user.js
// @supportURL   https://github.com/Dautsuro/userscripts/issues
// @homepageURL  https://github.com/Dautsuro/userscripts
// @top-level-await
// @noframes
// ==/UserScript==

const gameName = window.location.href.split('/')[5];
const gameData = await GM.getValue(gameName, {});

// Fetch all videos and edit attributes
// Add event listeners to enter and exit fullscreen when video is playing
// Disabled controls and cursor when in fullscreen for immersion
function editVideos() {
    const videoList = document.querySelectorAll('video');

    for (const video of videoList) {
        if (video.edited) {
            continue;
        }

        video.autoplay = false;
        video.muted = false;
        video.controls = true;
        video.loop = false;
        video.volume = 1.0;
        video.edited = true;

        let videoId;

        if (video.src) {
            videoId = video.src.split('/').slice(7).join('/');
        } else {
            const source = video.querySelector('source');
            videoId = source.src.split('/').slice(7).join('/');
        }

        if (!gameData[videoId]) {
            gameData[videoId] = false;
            video.style.border = '2px solid red';
        } else {
            video.style.border = '2px solid green';
        }

        video.addEventListener('play', () => {
            video.controls = false;
            video.style.cursor = 'none';
            video.requestFullscreen();

            // Nested setTimeout because sometimes the video start playing before freezing
            // So we first fetch the currentTime, then we check 
            setTimeout(() => {
                const currentTime = video.currentTime;

                setTimeout(() => {
                    if (video.currentTime === currentTime) {
                        video.currentTime = 0.0001;
                        video.play();
                    }
                }, 100);
            }, 500);
        });

        video.addEventListener('pause', () => {
            document.exitFullscreen();
            video.style.cursor = 'unset';
            video.controls = true;
        });

        video.addEventListener('ended', () => {
            gameData[videoId] = true;
            video.style.border = '2px solid green';
            GM.setValue(gameName, gameData);
        });
    }
}

editVideos();

// MutationObserver is triggered for every change except for the videos attributes
const observer = new MutationObserver((mutationList) => {
    for (const mutation of mutationList) {
        const attributeList = ['autoplay', 'muted', 'controls', 'loop', 'volume'];

        if (mutation.type === 'attributes' && attributeList.includes(mutation.attributeName)) {
            continue;
        }

        editVideos();
    }
});

observer.observe(document.body, { childList: true, attributes: true, subtree: true });