import sharp from 'sharp';
sharp.concurrency(1);
// Every source region is covered; overlap retains table labels at tile edges.
export async function prepareVisionImage(image){
 const input=Buffer.from(image.base64,'base64');
 const {width,height}=await sharp(input,{limitInputPixels:25000000}).metadata();
 if(!width||!height)throw Error('圖片尺寸無法讀取');
 const overview=await sharp(input,{limitInputPixels:25000000}).resize({width:2400,height:2400,fit:'inside',withoutEnlargement:true}).png().toBuffer();
 const images=[overview.toString('base64')],regions=[{left:0,top:0,width,height,overview:true}];
 const positions=length=>{if(length<=768)return [0];const values=[];for(let start=0;start<length-768;start+=576)values.push(start);values.push(length-768);return [...new Set(values)]};
 for(const top of positions(height))for(const left of positions(width)){
  const rect={left,top,width:Math.min(768,width-left),height:Math.min(768,height-top)};
  const buffer=await sharp(input,{limitInputPixels:25000000}).extract(rect).resize({width:rect.width*2,height:rect.height*2,fit:'fill'}).png().toBuffer();
  images.push(buffer.toString('base64'));regions.push(rect);
 }
 return {images,regions,width,height,method:'full-coverage-overlapping-tiles-two-pass'};
}
