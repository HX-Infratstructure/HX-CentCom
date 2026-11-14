import { describe, expect, it } from 'vitest';
import { filterTasks, ganttPosition, type Task } from '@/lib/task-data';
const rows=[{id:'IRP-04',agent:'CC2',title:'Qualification',repository:'HX-Semantic-Router',host:'HX-18',status:'In progress'},{id:'IRP-05',agent:'CC1',title:'D3 adapter',repository:'HX-Semantic-Router',host:'HX-18',status:'Complete'}] as Task[];
describe('Agent task progress',()=>{
 it('keeps updates scoped to the selected agent',()=>{expect(filterTasks(rows,'CC1','','All tasks').map(t=>t.id)).toEqual(['IRP-05']);});
 it('shows only completed tasks in the completed view',()=>{expect(filterTasks(rows,'','','Completed').map(t=>t.id)).toEqual(['IRP-05']);});
 it('positions each task for its inclusive date span',()=>{expect(ganttPosition('2026-11-10','2026-11-18','2026-11-09',21)).toEqual({left:100/21,width:900/21});});
 it('clips tasks outside the visible Gantt window',()=>{expect(ganttPosition('2026-11-01','2026-11-03','2026-11-09',21)).toEqual({left:0,width:0});});
});
