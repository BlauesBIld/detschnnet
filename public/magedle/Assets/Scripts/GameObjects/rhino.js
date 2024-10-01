class Rhino extends ImageObject{

    spriteSheetChangeSpeed = 0;
    timeStampLastSpriteSheetChanged = 0;
    isBeingPattedCurrently = false;
    constructor(x, y, widht, height) {
        super("wall", "Rhino.png", x, y, widht, height, 530, 630, 2, true);
    }

    update() {
        super.update();
        if(this.spriteSheetChangeSpeed > 0){
            if(this.timeStampLastSpriteSheetChanged + this.spriteSheetChangeSpeed < Date.now()) {
                this.currentColumnInSpriteSheet++;
                if (this.currentColumnInSpriteSheet >= 9) {
                    this.currentColumnInSpriteSheet = 0;
                    this.isBeingPattedCurrently = false;
                    this.spriteSheetChangeSpeed = 0;
                }
                this.timeStampLastSpriteSheetChanged = Date.now();
            }
        }
    }

    startPatting() {
        if(!this.isBeingPattedCurrently) {
            playerManager.goldCoinsAmount+=10;
            uiManager.initializePage();
            this.spriteSheetChangeSpeed = 150;
            this.isBeingPattedCurrently = true;
            new FadingImagePopUp("Heart.png", this.position.x+30, gameCanvas.canvasBoundaries.bottom-180, 50);
        }
    }

}