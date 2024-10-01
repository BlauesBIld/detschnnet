class GameObject {
    name = "";
    isActive = true;

    position = {
        x: 20,
        y: 20,
    };

    prevPosition = {
        x: 20,
        y: 20,
    };

    gameObjectIndex;

    boundaries = {
        getLeftBoundary: () => {
            return this.position.x;
        },
        getRightBoundary: () => {
            return this.position.x + this.dimensions.width;
        },
        getTopBoundary: () => {
            return this.position.y;
        },
        getBottomBoundary: () => {
            return this.position.y + this.dimensions.height;
        },
    };

    dimensions = {
        width: 50,
        height: 50,
    };

    constructor(name, x, y, width, height) {
        this.name = name;
        this.position.x = x;
        this.position.y = y;
        this.dimensions.width = width;
        this.dimensions.height = height;
        gameManager.addGameObject(this);
    }

    storePosition(){
        this.prevPosition.x = this.position.x;
        this.prevPosition.y = this.position.y;
    }

    reStorePosition(){
        this.position.x = this.prevPosition.x;
        this.position.y = this.prevPosition.y;
    }

    update() {}

    draw() {}

    onCollision(otherObject) {}

    isCollidingWith(otherObject){
        if (this.boundaries.getLeftBoundary() <= otherObject.boundaries.getRightBoundary() &&
            this.boundaries.getRightBoundary() >= otherObject.boundaries.getLeftBoundary()) {
            if (this.boundaries.getTopBoundary() <= otherObject.boundaries.getBottomBoundary() &&
                this.boundaries.getBottomBoundary() >= otherObject.boundaries.getTopBoundary()) {
                return true;
            }
        }
        return false;
    }

    destroy() {
        this.isActive = false;
    }

    recreate(){
        this.isActive = true;
    }
}
