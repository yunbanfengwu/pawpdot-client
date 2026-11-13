// Protocol fixtures also used by the Flutter interoperability tests. These
// examples are opt-in and never change the current production phone interface.
export function approvalExtension() {
  return {id: 'example.approval', version: '1.0.0', title: '审批工作台', permissions: ['ui.invoke'], actions: [{id: 'open', title: '查看申请'}, {id: 'approve', title: '通过申请'}], contributions: [
    {id: 'navigation', slot: 'sidebar.items', order: 0, node: {type: 'button', label: '待审批', action: 'open', icon: 'file'}},
    {id: 'workspace', slot: 'main', order: 0, node: {type: 'column', title: '待审批', children: [{type: 'text', text: '设备采购申请'}, {type: 'input', id: 'comment', label: '审批意见', placeholder: '填写处理意见'}, {type: 'button', label: '通过申请', action: 'approve', icon: 'check'}]}},
    {id: 'settings', slot: 'settings.items', order: 0, node: {type: 'button', label: '审批设置', action: 'open', icon: 'settings'}}
  ]};
}
export function toolsExtension() {
  return {id: 'example.tools', version: '1.0.0', title: '终端工具', permissions: ['ui.invoke'], actions: [{id: 'details', title: '查看详情'}, {id: 'send', title: '提交内容'}], contributions: [
    {id: 'header', slot: 'header.actions', order: 0, node: {type: 'button', label: '详情', action: 'details', icon: 'info'}},
    {id: 'above', slot: 'composer.above', order: 0, node: {type: 'text', text: '提交到当前终端'}},
    {id: 'input', slot: 'composer.input', order: 0, node: {type: 'input', id: 'message', label: '内容', placeholder: '输入需要提交的内容'}},
    {id: 'tools', slot: 'composer.tools', order: 0, node: {type: 'button', label: '发送', action: 'send', icon: 'send'}},
    {id: 'expanded', slot: 'composer.expanded', order: 0, node: {type: 'column', children: [{type: 'text', text: '业务选项'}, {type: 'input', id: 'tag', label: '标签'}]}},
    {id: 'cards', slot: 'content.cards', order: 0, node: {type: 'card', title: '当前任务', children: [{type: 'text', text: '等待终端处理'}, {type: 'button', label: '查看任务', action: 'details'}]}}
  ]};
}
