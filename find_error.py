"""二分查找 JS 语法错误位置"""
with open(r'c:\Users\姚\Documents\trae_projects\48moniqi\deploy\app.js', encoding='utf-8') as f:
    code = f.read()

# 找到 showProactiveEvent 周围的代码
target = 'showProactiveEvent(event) {'
idx = code.find(target)
print(f'showProactiveEvent starts at {idx}')
# 输出前后 500 字符
print('=== context ===')
print(code[max(0,idx-200):idx+800])
print('=== end ===')
