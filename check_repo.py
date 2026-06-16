import requests
token = open(r'c:\Users\姚\Documents\trae_projects\48moniqi\deploy\.github_token').read().strip()
headers = {'Authorization': f'token {token}', 'Accept': 'application/vnd.github.v3+json'}

# Check iver027/kodai48
r = requests.get('https://api.github.com/repos/iver027/kodai48', headers=headers, timeout=15)
print(f'iver027/kodai48: {r.status_code}')
if r.status_code == 200:
    data = r.json()
    print(f'  Full name: {data["full_name"]}')
    print(f"  Permissions: {data.get('permissions', {})}")
elif r.status_code == 404:
    print('  REPO NOT FOUND')

# Check river0727/kodai48
r2 = requests.get('https://api.github.com/repos/river0727/kodai48', headers=headers, timeout=15)
print(f'river0727/kodai48: {r2.status_code}')
if r2.status_code == 200:
    data = r2.json()
    print(f'  Full name: {data["full_name"]}')
    print(f"  Permissions: {data.get('permissions', {})}")
elif r2.status_code == 404:
    print('  REPO NOT FOUND')

# Also list repos for the user
r3 = requests.get('https://api.github.com/user/repos?per_page=10', headers=headers, timeout=15)
print(f'\nYour repos (page 1):')
for repo in r3.json():
    print(f'  {repo["full_name"]} - push: {repo["permissions"]["push"]}')
