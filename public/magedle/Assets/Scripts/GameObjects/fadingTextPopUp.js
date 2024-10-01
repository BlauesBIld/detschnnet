class FadingTextPopUp extends GameObject{
    text;
    currentTransparancy;
    timeStampCreated;
    delayToStartDissappearing = 400;
    textSize;
    directionToFadeY;

    constructor(text, x, y, textSize = 35, directionToFadeY = -1) {
        super("fadingPopUp", x, y, 0, 0);
        this.text = text;
        this.currentTransparancy = 1;
        this.timeStampCreated = Date.now();
        this.textSize = textSize;
        this.directionToFadeY = directionToFadeY;
    }

    draw() {
        gameManager.gameCanvas.drawLayer.save();
        gameManager.gameCanvas.drawLayer.font = 'bold ' + this.textSize + 'px \'MedievalSharp\'';
        gameManager.gameCanvas.drawLayer.fillStyle = 'red';
        gameManager.gameCanvas.drawLayer.textAlign = 'center';
        gameManager.gameCanvas.drawLayer.globalAlpha = this.currentTransparancy;
        gameManager.gameCanvas.drawLayer.strokeStyle = 'black';
        gameManager.gameCanvas.drawLayer.lineWidth = 4;
        gameManager.gameCanvas.drawLayer.strokeText(this.text, this.position.x, this.position.y);
        gameManager.gameCanvas.drawLayer.fillText(this.text, this.position.x, this.position.y);
        gameManager.gameCanvas.drawLayer.restore();
    }

    update() {
        if(this.timeStampCreated + this.delayToStartDissappearing < Date.now()) {
            this.currentTransparancy -= 0.05;
            if (this.currentTransparancy <= 0) {
                this.destroy();
            }
        }
        this.position.y += 0.2 * this.directionToFadeY;
    }
}