class GrasTile extends ImageObject {
    constructor(name, src, size, spawnX, spawnY) {
        super(name, src, getRandomIntFromSpawnLocs(size, spawnX), getRandomIntFromSpawnLocs(size, spawnY, 30), size, size);
    }
}


function getRandomIntFromSpawnLocs(size, coord, min = 0){
    let numb = (getRandomInt(size*2) - size/2)+coord;
    if(numb < min){
        numb = getRandomIntFromSpawnLocs(size, coord, min)
    }
    return numb;
}