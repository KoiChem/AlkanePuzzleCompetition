import postgres from 'postgres';
import { PostgresDatabase, type Query } from './postgres-database';
import type { TransactionRunner } from './supabase-gateway';
export function transactionIsolation(scope:string){
  return scope.startsWith('room:')||scope.startsWith('broadcast:')?'read committed':'serializable';
}
export function postgresTransactions(connectionString:string):TransactionRunner {
  // Transaction-mode Supavisor does not support prepared statements.
  const sql=postgres(connectionString,{prepare:false,max:1,ssl:'require',idle_timeout:1,connect_timeout:10});
  return async<T>(scope:string,run:(db:PostgresDatabase)=>Promise<T>):Promise<T>=>{
    for(let attempt=0;;attempt++){
      // SERIALIZABLE snapshots taken by the lock SELECT would predate waiting.
      // Room commands instead read fresh statements after their shared mutex.
      try{return await sql.begin(`isolation level ${transactionIsolation(scope)}`,async tx=>{
        await tx.unsafe('SET LOCAL statement_timeout = 9000');
        await tx.unsafe('SET LOCAL lock_timeout = 7000');
        await tx.unsafe('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[scope]);
        const execute:Query=async(query,values)=>{
          try {
            const rows=await tx.unsafe(query,values as any[]);
            return {rows:Array.from(rows) as Record<string,unknown>[],affectedRows:rows.count};
          } catch(error) {
            // Static SQL and SQLSTATE only; bound answers and credentials are never logged.
            console.error(JSON.stringify({event:'database_query_failed',code:(error as {code?:string}).code,query}));
            throw error;
          }
        };
        const result=await run(new PostgresDatabase(execute));
        if(result instanceof Response&&result.status>=500)throw result;
        return result;
      }) as T;}catch(error){
        if(error instanceof Response)return error as T;
        if(attempt<4&&['40001','40P01'].includes((error as {code?:string}).code??'')){
          await new Promise(resolve=>setTimeout(resolve,25*2**attempt+Math.floor(Math.random()*50)));
          continue;
        }
        throw error;
      }
    }
  };
}
