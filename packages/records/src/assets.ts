/** Compiled distributions embed the original schema bytes; development reads them in place. */
export async function readSchema(file:string,directory:string):Promise<Record<string,unknown>> {
  if(!/^[a-z0-9-]+\.schema\.json$/.test(file))throw new Error(`Invalid schema asset name ${file}`);
  const embedded=Bun.embeddedFiles.find(blob=>(blob as Blob & {name?:string}).name?.replaceAll("\\","/").split("/").at(-1)===file);
  if(embedded)return JSON.parse(await embedded.text());
  return Bun.file(`${directory}/${file}`).json();
}
