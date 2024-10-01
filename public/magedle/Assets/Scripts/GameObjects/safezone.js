class Safezone extends ImageObject{
    opacityOfZone = 0;
    maxOpacityOfZone = 0.7;
    diffOpacityOfZone = 0.008;

    constructor(name, fileName, x, y, width, height) {
        super(name, fileName, x, y, width, height);
    }


    update() {
        this.opacityOfZone += this.diffOpacityOfZone;
        if(this.opacityOfZone > this.maxOpacityOfZone){
            this.diffOpacityOfZone = -0.008;
        } else if (this.opacityOfZone <= 0){
            this.opacityOfZone = 0;
            this.diffOpacityOfZone = 0.008;
        }
    }

    draw() {
        gameManager.gameCanvas.drawLayer.save();
        gameManager.gameCanvas.drawLayer.globalAlpha = this.opacityOfZone;
        gameManager.gameCanvas.drawLayer.beginPath();
        gameManager.gameCanvas.drawLayer.drawImage(this.image, 0, 0, this.dimensions.width*(this.image.width/this.dimensions.width), this.dimensions.height*(this.image.height/this.dimensions.height), this.position.x, this.position.y, this.dimensions.width, this.dimensions.height);
        gameManager.gameCanvas.drawLayer.closePath();
        gameManager.gameCanvas.drawLayer.restore();
    }
}