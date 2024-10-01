class FadingTitleText extends GameObject {
    text;
    currentTransparancy;
    timeStampCreated;
    delayToStartDisappearing = 1500;

    constructor() {
        super("title", gameManager.gameCanvas.canvasBoundaries.right/2, gameManager.gameCanvas.canvasBoundaries.bottom/3, 0, 0);
        this.text = "";
        this.currentTransparancy = 0;
        this.timeStampCreated = Date.now();
    }

    draw() {
        gameManager.gameCanvas.drawLayer.save();
        gameManager.gameCanvas.drawLayer.font = 'bold 128px \'MedievalSharp\'';
        gameManager.gameCanvas.drawLayer.fillStyle = 'black';
        gameManager.gameCanvas.drawLayer.textAlign = 'center';
        gameManager.gameCanvas.drawLayer.globalAlpha = this.currentTransparancy;
        gameManager.gameCanvas.drawLayer.fillText(this.text, this.position.x, this.position.y);
        gameManager.gameCanvas.drawLayer.restore();
    }

    update() {
        if(this.timeStampCreated + this.delayToStartDisappearing < Date.now()) {
            this.currentTransparancy -= 0.003;
            if (this.currentTransparancy <= 0) {
                this.destroy();
            }
        }
    }

    displayNewTitle(text){
        this.isActive = true;
        this.timeStampCreated = Date.now();
        this.currentTransparancy = 1;
        this.text = text;
    }
}