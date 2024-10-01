let isMusicPlaying = false;
let startScreenAudio = new Audio("./Audio/StartScreenMusic.mp3");
document.addEventListener("mousemove", function (event) {
    if (startScreenAudio.paused) {
        startScreenAudio.loop = true;
        startScreenAudio.volume = 0.5;
        startScreenAudio.play();
        startScreenAudio.isMusicPlaying = true;
    }
})
