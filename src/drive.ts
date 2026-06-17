import {google} from "googleapis";
import "dotenv/config";

export async function driveClient(){

 const auth = new google.auth.GoogleAuth({
  keyFile:
   process.env.GOOGLE_CREDENTIAL ||
   "credential.json",

  scopes:[
   "https://www.googleapis.com/auth/drive.readonly"
  ]
 });

 return google.drive({
  version:"v3",
  auth:await auth.getClient()
 });

}